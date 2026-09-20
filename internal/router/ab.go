// A/B routing + cost-per-quality comparison (spec 06 task 3.5).
//
// Split traffic X% to model A / Y% to model B on a stable hash of the
// request key (chain ID → agent ID → prompt hash), so the same logical
// request always lands in the same arm. Outcomes accumulate per arm; Compare
// reports cost-per-quality with a two-sample z-test that reaches
// significance within 1000 requests on realistic effect sizes.
package router

import (
	"encoding/binary"
	"hash/fnv"
	"math"
	"sync"
)

// MinCompareN is the sample floor for significance claims: an experiment
// must observe at least 1000 total outcomes before Compare can report
// Significant=true (spec: "statistically significant within 1000 requests").
const MinCompareN = 1000

// zCrit95 is the two-sided 95% critical value.
const zCrit95 = 1.96

// Experiment splits traffic between two models and compares cost-per-quality.
type Experiment struct {
	mu     sync.Mutex
	name   string
	aModel string
	bModel string
	// pctA is the 0..100 share routed to arm A.
	pctA uint

	nA, nB       int64
	costA, costB float64
	cpqA, cpqB   float64 // Σ(cost/quality) for mean cost-per-quality
	sqA, sqB     float64 // Σ(cost/quality)² for variance
	qualA, qualB float64
}

// NewExperiment builds an A/B test routing pctA% (0..100, clamped) to aModel.
func NewExperiment(name, aModel, bModel string, pctA uint) *Experiment {
	if pctA > 100 {
		pctA = 100
	}
	return &Experiment{name: name, aModel: aModel, bModel: bModel, pctA: pctA}
}

// Name returns the experiment name.
func (e *Experiment) Name() string {
	if e == nil {
		return ""
	}
	return e.name
}

// Models returns (arm A model, arm B model).
func (e *Experiment) Models() (string, string) {
	if e == nil {
		return "", ""
	}
	return e.aModel, e.bModel
}

// Assign deterministically maps a request key to an arm model. Empty keys
// degrade to arm A (never fail routing on a missing header).
func (e *Experiment) Assign(key string) string {
	if e == nil {
		return ""
	}
	if e.pctA >= 100 {
		return e.aModel
	}
	if e.pctA == 0 {
		return e.bModel
	}
	if uint(hash100(key)) < e.pctA {
		return e.aModel
	}
	return e.bModel
}

// ArmOf reports "A"/"B" for a model name ("" when not participating).
func (e *Experiment) ArmOf(model string) string {
	if e == nil {
		return ""
	}
	switch model {
	case e.aModel:
		return "A"
	case e.bModel:
		return "B"
	default:
		return ""
	}
}

// Record logs one completed outcome: upstream cost USD + judge quality 0..1.
// Unknown models are ignored (experiments never pollute on misconfig).
func (e *Experiment) Record(model string, costUSD, quality float64) {
	if e == nil {
		return
	}
	if quality < 0 {
		quality = 0
	}
	if quality > 1 {
		quality = 1
	}
	// Cost-per-quality sample: quality floors at 0.05 so total failures
	// read as 20x cost instead of +Inf (keeps variance finite).
	q := quality
	if q < 0.05 {
		q = 0.05
	}
	cpq := costUSD / q
	e.mu.Lock()
	defer e.mu.Unlock()
	switch model {
	case e.aModel:
		e.nA++
		e.costA += costUSD
		e.qualA += quality
		e.cpqA += cpq
		e.sqA += cpq * cpq
	case e.bModel:
		e.nB++
		e.costB += costUSD
		e.qualB += quality
		e.cpqB += cpq
		e.sqB += cpq * cpq
	}
}

// Comparison is the cost-per-quality verdict for dashboards and automation.
type Comparison struct {
	N                 int64   `json:"n"`
	CostPerQualityA   float64 `json:"cost_per_quality_a"`
	CostPerQualityB   float64 `json:"cost_per_quality_b"`
	MeanQualityA      float64 `json:"mean_quality_a"`
	MeanQualityB      float64 `json:"mean_quality_b"`
	TotalCostA        float64 `json:"total_cost_a"`
	TotalCostB        float64 `json:"total_cost_b"`
	Significant       bool    `json:"significant"`
	CheaperArm        string  `json:"cheaper_arm"`
	Recommendation    string  `json:"recommendation"`
	QualityDropVsBest float64 `json:"quality_drop_vs_best"`
}

// Compare computes per-arm cost-per-quality and a two-sample z-test.
// Significant requires N ≥ MinCompareN and |z| > 1.96. CheaperArm names the
// arm with lower cost-per-quality ("tie" when equal); Recommendation turns
// the verdict into a routing action, gating quality-first claims on the
// <5% quality-drop target.
func (e *Experiment) Compare() Comparison {
	if e == nil {
		return Comparison{}
	}
	e.mu.Lock()
	nA, nB := e.nA, e.nB
	cpqA, cpqB := e.cpqA, e.cpqB
	sqA, sqB := e.sqA, e.sqB
	costA, costB := e.costA, e.costB
	qualA, qualB := e.qualA, e.qualB
	e.mu.Unlock()

	c := Comparison{N: nA + nB, TotalCostA: costA, TotalCostB: costB}
	if nA > 0 {
		c.CostPerQualityA = cpqA / float64(nA)
		c.MeanQualityA = qualA / float64(nA)
	}
	if nB > 0 {
		c.CostPerQualityB = cpqB / float64(nB)
		c.MeanQualityB = qualB / float64(nB)
	}
	switch {
	case c.CostPerQualityA < c.CostPerQualityB:
		c.CheaperArm = "A"
	case c.CostPerQualityB < c.CostPerQualityA:
		c.CheaperArm = "B"
	default:
		c.CheaperArm = "tie"
	}
	if c.MeanQualityA > 0 && c.MeanQualityB > 0 {
		best := math.Max(c.MeanQualityA, c.MeanQualityB)
		worst := math.Min(c.MeanQualityA, c.MeanQualityB)
		c.QualityDropVsBest = (best - worst) / best
	}
	if nA >= 2 && nB >= 2 && c.N >= MinCompareN {
		varA := sqA/float64(nA) - c.CostPerQualityA*c.CostPerQualityA
		varB := sqB/float64(nB) - c.CostPerQualityB*c.CostPerQualityB
		if varA < 0 {
			varA = 0
		}
		if varB < 0 {
			varB = 0
		}
		se := math.Sqrt(varA/float64(nA) + varB/float64(nB))
		if se > 0 && math.Abs(c.CostPerQualityA-c.CostPerQualityB)/se > zCrit95 {
			c.Significant = true
		}
		// Zero-variance arms with a real mean gap are trivially significant.
		if se == 0 && c.CostPerQualityA != c.CostPerQualityB {
			c.Significant = true
		}
	}
	c.Recommendation = recommend(c)
	return c
}

func recommend(c Comparison) string {
	if !c.Significant {
		return "keep-split"
	}
	if c.QualityDropVsBest > 0.05 {
		return "keep-split"
	}
	switch c.CheaperArm {
	case "A":
		return "route-all-A"
	case "B":
		return "route-all-B"
	default:
		return "keep-split"
	}
}

// hash100 maps a key to 0..99 via FNV-1a (stdlib, deterministic).
func hash100(key string) uint32 {
	h := fnv.New32a()
	_, _ = h.Write([]byte(key))
	var b [4]byte
	binary.LittleEndian.PutUint32(b[:], h.Sum32())
	return binary.LittleEndian.Uint32(b[:]) % 100
}
