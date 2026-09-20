// Onboarding entry — ship-track builder (spec 19 §Onboarding Flow).
// Public by design (pre-auth first run + authed replay from settings), so no
// session redirect here — unlike login/signup.

import OnboardingFlow from "./onboarding-flow";

export const dynamic = "force-dynamic";

export default function OnboardingPage() {
  return <OnboardingFlow />;
}
