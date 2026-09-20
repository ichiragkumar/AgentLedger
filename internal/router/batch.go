// Batch routing (spec 06 task 3.8): non-urgent requests skip the realtime
// path and queue for batch providers (50% discount, hours not seconds).
//
// Eligibility comes from the caller, never from guessing: an explicit
// X-AgentLedger-Batch header, a batch-tagged task_type, or an explicit
// BatchEligible flag on router.Input. Delivery completes via webhook POST
// (Dispatcher.Deliver) or proxy polling (Queue.Dequeue loop); both live off
// the proxy hot path.
package router

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

// DiscountFactor is the batch price multiplier: batch APIs cost 50% of
// realtime (spec 06: "batch API (50% discount)").
const DiscountFactor = 0.5

// BatchHeader is the eligibility header. Value "eligible" (or "true"/"1")
// routes the request to the batch queue; anything else stays realtime.
const BatchHeader = "X-AgentLedger-Batch"

// BatchTaskTypes are task_type hints treated as batch-eligible.
var BatchTaskTypes = map[string]bool{
	"batch": true, "overnight": true, "embeddings-backfill": true,
	"bulk-classify": true, "report": true, "digest": true,
}

// Discounted returns the batch price for a realtime cost estimate.
func Discounted(realtimeUSD float64) float64 { return realtimeUSD * DiscountFactor }

// IsBatchEligible reports whether headers/task_type mark work non-urgent.
func IsBatchEligible(h http.Header, taskType string) bool {
	if h == nil {
		return BatchTaskTypes[strings.ToLower(strings.TrimSpace(taskType))]
	}
	switch strings.ToLower(strings.TrimSpace(h.Get(BatchHeader))) {
	case "eligible", "true", "1", "batch":
		return true
	case "realtime", "false", "0":
		return false
	}
	return BatchTaskTypes[strings.ToLower(strings.TrimSpace(taskType))]
}

// Job is one queued batch request.
type Job struct {
	ID         string    `json:"id"`
	Model      string    `json:"model"`
	AgentID    string    `json:"agent_id"`
	TaskType   string    `json:"task_type"`
	Prompt     string    `json:"prompt,omitempty"`
	WebhookURL string    `json:"webhook_url,omitempty"`
	EnqueuedAt time.Time `json:"enqueued_at"`
}

// Result is the completed batch output delivered to the webhook.
type Result struct {
	JobID          string  `json:"job_id"`
	Output         string  `json:"output"`
	PromptTokens   int     `json:"prompt_tokens"`
	CompleteTokens int     `json:"completion_tokens"`
	CostUSD        float64 `json:"cost_usd"`
	// DiscountedCostUSD is CostUSD × DiscountFactor (the 50% batch price).
	DiscountedCostUSD float64 `json:"discounted_cost_usd"`
}

// Queue is the non-urgent job buffer. MemoryQueue ships in-process; Postgres
// or Redis backends implement the same interface later.
type Queue interface {
	Enqueue(j Job) error
	Dequeue() (Job, bool)
	Len() int
	// Flush drains the queue, calling send per job until empty or error.
	Flush(send func(Job) error) error
}

// MemoryQueue is the in-process FIFO. Bounded by MaxJobs (0 = 1024);
// Enqueue past capacity returns ErrQueueFull instead of growing memory.
type MemoryQueue struct {
	mu    sync.Mutex
	jobs  []Job
	max   int
	next  int64
	drops int64
}

// ErrQueueFull is returned when a bounded queue overflows.
var ErrQueueFull = fmt.Errorf("router: batch queue full")

// NewMemoryQueue returns a FIFO capped at maxJobs (≤0 → 1024).
func NewMemoryQueue(maxJobs int) *MemoryQueue {
	if maxJobs <= 0 {
		maxJobs = 1024
	}
	return &MemoryQueue{max: maxJobs}
}

// Enqueue appends a job, stamping ID/EnqueuedAt when empty.
func (q *MemoryQueue) Enqueue(j Job) error {
	if q == nil {
		return fmt.Errorf("router: nil batch queue")
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.jobs) >= q.max {
		q.drops++
		return ErrQueueFull
	}
	q.next++
	if strings.TrimSpace(j.ID) == "" {
		j.ID = fmt.Sprintf("batch-%d", q.next)
	}
	if j.EnqueuedAt.IsZero() {
		j.EnqueuedAt = time.Now().UTC()
	}
	q.jobs = append(q.jobs, j)
	return nil
}

// Dequeue pops the oldest job (polling path). Ok=false when empty.
func (q *MemoryQueue) Dequeue() (j Job, ok bool) {
	if q == nil {
		return Job{}, false
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.jobs) == 0 {
		return Job{}, false
	}
	j = q.jobs[0]
	q.jobs[0] = Job{}
	q.jobs = q.jobs[1:]
	return j, true
}

// Len returns the queued depth (dashboard + backpressure).
func (q *MemoryQueue) Len() int {
	if q == nil {
		return 0
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.jobs)
}

// Drops returns the overflow-drop count.
func (q *MemoryQueue) Drops() int64 {
	if q == nil {
		return 0
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.drops
}

// Flush drains the queue in FIFO order; the first send error aborts and the
// failing job is re-queued at the head so nothing is lost.
func (q *MemoryQueue) Flush(send func(Job) error) error {
	if q == nil {
		return nil
	}
	for {
		j, ok := q.Dequeue()
		if !ok {
			return nil
		}
		if err := send(j); err != nil {
			q.mu.Lock()
			q.jobs = append([]Job{j}, q.jobs...)
			q.mu.Unlock()
			return err
		}
	}
}

// Dispatcher delivers completed batch results to caller webhooks.
type Dispatcher struct {
	// Client performs webhook POSTs (default: 10s-timeout stdlib client).
	Client *http.Client
}

func (d *Dispatcher) client() *http.Client {
	if d != nil && d.Client != nil {
		return d.Client
	}
	return &http.Client{Timeout: 10 * time.Second}
}

// Deliver POSTs result JSON to job.WebhookURL. Empty WebhookURL is a no-op
// nil (polling consumers fetch results out of band instead).
func (d *Dispatcher) Deliver(ctx context.Context, j Job, r Result) error {
	if strings.TrimSpace(j.WebhookURL) == "" {
		return nil
	}
	r.JobID = j.ID
	r.DiscountedCostUSD = Discounted(r.CostUSD)
	body, err := json.Marshal(r)
	if err != nil {
		return fmt.Errorf("router: encode batch result: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, j.WebhookURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("router: build webhook request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-AgentLedger-Batch-Job", j.ID)
	resp, err := d.client().Do(req)
	if err != nil {
		return fmt.Errorf("router: webhook deliver: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("router: webhook deliver: status %d", resp.StatusCode)
	}
	return nil
}
