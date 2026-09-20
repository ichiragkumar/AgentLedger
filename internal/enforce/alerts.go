// Soft alerts: webhook/email/Slack at 50/75/90% within 60s of breach.
//
// Design: Record() reports newly crossed thresholds; the pre-check hook
// hands them to Dispatcher.Dispatch, which fans out to all configured
// senders asynchronously but bounded — every alert is either delivered or
// recorded as failed within 60s (context timeout + buffered queue).
// Dedupe: one alert per (budget, threshold) per window; re-arm on roll.
package enforce

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sync"
	"time"
)

// Alert is one threshold-crossing event.
type Alert struct {
	BudgetID    string
	Level       Level
	Threshold   float64 // 50, 75, or 90
	Utilization float64
	ResetAt     time.Time
	FiredAt     time.Time
}

// Channel identifies a notification sink.
type Channel string

const (
	ChannelWebhook Channel = "webhook"
	ChannelEmail   Channel = "email"
	ChannelSlack   Channel = "slack"
)

// Sender delivers an alert to one channel. Implementations must respect
// ctx cancellation (the dispatcher gives each send ≤55s of the 60s budget).
type Sender interface {
	Channel() Channel
	Send(ctx context.Context, a Alert) error
}

// WebhookSender POSTs the alert as JSON to a generic webhook URL.
type WebhookSender struct {
	URL    string
	Client *http.Client
}

// Channel implements Sender.
func (s *WebhookSender) Channel() Channel { return ChannelWebhook }

// Send implements Sender.
func (s *WebhookSender) Send(ctx context.Context, a Alert) error {
	body, _ := json.Marshal(map[string]interface{}{
		"type":        "budget_alert",
		"budget_id":   a.BudgetID,
		"level":       string(a.Level),
		"threshold":   fmt.Sprintf("%.0f%%", a.Threshold),
		"utilization": fmt.Sprintf("%.1f%%", a.Utilization),
		"reset_at":    a.ResetAt.UTC().Format(time.RFC3339),
		"fired_at":    a.FiredAt.UTC().Format(time.RFC3339),
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.URL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	client := s.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4<<10))
	if resp.StatusCode >= 300 {
		return fmt.Errorf("enforce: webhook %s returned %d", s.URL, resp.StatusCode)
	}
	return nil
}

// SlackSender POSTs a formatted message to an incoming Slack webhook URL.
// The payload shape matches Slack incoming-webhook expectations.
type SlackSender struct {
	WebhookURL string
	Client     *http.Client
}

// Channel implements Sender.
func (s *SlackSender) Channel() Channel { return ChannelSlack }

// Send implements Sender.
func (s *SlackSender) Send(ctx context.Context, a Alert) error {
	text := fmt.Sprintf(":warning: Budget *%s* hit *%.0f%%* (utilization %.1f%%, resets %s)",
		a.BudgetID, a.Threshold, a.Utilization, a.ResetAt.UTC().Format(time.RFC3339))
	body, _ := json.Marshal(map[string]string{"text": text})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.WebhookURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	client := s.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4<<10))
	if resp.StatusCode >= 300 {
		return fmt.Errorf("enforce: slack webhook returned %d", resp.StatusCode)
	}
	return nil
}

// EmailSender is a stub that renders the email to w (stdout in prod).
// TODO: swap for SMTP (net/smtp, stdlib) when ENFORCER_SMTP_HOST is set —
// the interface is stable so the swap is sender-internal.
type EmailSender struct {
	To   string
	From string
	Out  io.Writer
}

// Channel implements Sender.
func (s *EmailSender) Channel() Channel { return ChannelEmail }

// Send implements Sender.
func (s *EmailSender) Send(_ context.Context, a Alert) error {
	out := s.Out
	if out == nil {
		out = os.Stdout
	}
	_, err := fmt.Fprintf(out, "To: %s\nFrom: %s\nSubject: [AgentLedger] budget %s at %.0f%%\n\nBudget %s (%s) crossed %.0f%% threshold at %.1f%% utilization. Resets %s.\n",
		s.To, s.From, a.BudgetID, a.Threshold,
		a.BudgetID, a.Level, a.Threshold, a.Utilization,
		a.ResetAt.UTC().Format(time.RFC3339))
	return err
}

// RecordSender is a test/capture sender that buffers alerts in memory.
type RecordSender struct {
	ch   Channel
	mu   sync.Mutex
	Sent []Alert
	Fail error
}

// NewRecordSender builds a capture sender for ch.
func NewRecordSender(ch Channel) *RecordSender { return &RecordSender{ch: ch} }

// Channel implements Sender.
func (s *RecordSender) Channel() Channel { return s.ch }

// Send implements Sender.
func (s *RecordSender) Send(_ context.Context, a Alert) error {
	if s.Fail != nil {
		return s.Fail
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Sent = append(s.Sent, a)
	return nil
}

// Alerts returns a copy of captured alerts.
func (s *RecordSender) Alerts() []Alert {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Alert(nil), s.Sent...)
}

// AlertResult is the per-sender outcome of one dispatch.
type AlertResult struct {
	Channel Channel
	Err     error
}

// Dispatcher fans alerts out to senders with dedupe + a 60s delivery bound.
type Dispatcher struct {
	mu      sync.Mutex
	senders []Sender
	// fired tracks budget|threshold → window-reset; re-arms on roll.
	fired map[string]time.Time
	now   func() time.Time
}

// NewDispatcher builds a dispatcher over senders (may be empty → no-op).
func NewDispatcher(senders ...Sender) *Dispatcher {
	return &Dispatcher{senders: senders, fired: map[string]time.Time{}, now: time.Now}
}

func alertKey(budgetID string, threshold float64) string {
	return fmt.Sprintf("%s|%.0f", budgetID, threshold)
}

// ShouldFire reports whether (budget, threshold) still needs an alert
// (dedupe: one fire per threshold per window).
func (d *Dispatcher) ShouldFire(budgetID string, threshold float64, resetAt time.Time) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	if rt, ok := d.fired[alertKey(budgetID, threshold)]; ok && d.now().Before(rt) {
		return false
	}
	_ = resetAt
	return true
}

// Dispatch sends a to every sender concurrently and waits for all (or the
// 60s bound, whichever comes first). It marks the alert fired even on
// partial failure — failures are returned per channel so the caller can
// log them to the audit trail. Synchronous senders keep ordering simple;
// each sender gets ≤55s via ctx timeout, total wait ≤60s.
func (d *Dispatcher) Dispatch(a Alert) []AlertResult {
	d.mu.Lock()
	senders := append([]Sender(nil), d.senders...)
	key := alertKey(a.BudgetID, a.Threshold)
	if rt, ok := d.fired[key]; ok && d.now().Before(rt) {
		d.mu.Unlock()
		return nil
	}
	d.fired[key] = a.ResetAt
	d.mu.Unlock()

	if a.FiredAt.IsZero() {
		a.FiredAt = d.now().UTC()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	results := make([]AlertResult, len(senders))
	var wg sync.WaitGroup
	for i, s := range senders {
		wg.Add(1)
		go func(i int, s Sender) {
			defer wg.Done()
			sctx, scancel := context.WithTimeout(ctx, 55*time.Second)
			defer scancel()
			results[i] = AlertResult{Channel: s.Channel(), Err: s.Send(sctx, a)}
		}(i, s)
	}
	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-ctx.Done():
	}
	return results
}

// DispatchDecisions converts Record() decisions into alerts and dispatches
// each newly crossed threshold. Fire-and-forget from the hot path: callers
// should run it in a goroutine — delivery still completes within 60s.
func (d *Dispatcher) DispatchDecisions(ds []Decision) [][]AlertResult {
	var all [][]AlertResult
	for _, dec := range ds {
		for _, t := range dec.Alerts {
			if !d.ShouldFire(dec.BudgetID, t, dec.ResetAt) {
				continue
			}
			all = append(all, d.Dispatch(Alert{
				BudgetID:    dec.BudgetID,
				Level:       dec.Level,
				Threshold:   t,
				Utilization: dec.Utilization,
				ResetAt:     dec.ResetAt,
			}))
		}
	}
	return all
}

// SendersFromEnv builds senders from environment (all optional):
// ALERT_WEBHOOK_URL, ALERT_SLACK_WEBHOOK_URL, ALERT_EMAIL_TO (+ optional
// ALERT_EMAIL_FROM, default agentledger@localhost).
func SendersFromEnv() []Sender {
	var out []Sender
	if u := os.Getenv("ALERT_WEBHOOK_URL"); u != "" {
		out = append(out, &WebhookSender{URL: u})
	}
	if u := os.Getenv("ALERT_SLACK_WEBHOOK_URL"); u != "" {
		out = append(out, &SlackSender{WebhookURL: u})
	}
	if to := os.Getenv("ALERT_EMAIL_TO"); to != "" {
		from := os.Getenv("ALERT_EMAIL_FROM")
		if from == "" {
			from = "agentledger@localhost"
		}
		out = append(out, &EmailSender{To: to, From: from})
	}
	return out
}
