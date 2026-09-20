import Navbar from "@/components/landing/navbar";
import Hero from "@/components/landing/hero";
import SocialProofBar from "@/components/landing/social-proof-bar";
import Problem from "@/components/landing/problem";
import HowItWorks from "@/components/landing/how-it-works";
import FeaturesBento from "@/components/landing/features-bento";
import LiveDemo from "@/components/landing/live-demo";
// Sibling-owned (ledger-web-journey) — land separately; coordinator integrates.
// These imports resolve once apps/web/components/landing/{product-journey,numbers,pricing}.tsx exist.
import ProductJourney from "../components/landing/product-journey";
import Numbers from "../components/landing/numbers";
import Pricing from "../components/landing/pricing";
import OpenSource from "@/components/landing/open-source";
import Faq from "@/components/landing/faq";
import Cta from "@/components/landing/cta";
import Footer from "@/components/landing/footer";

export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <SocialProofBar />
        <Problem />
        <HowItWorks />
        <FeaturesBento />
        <LiveDemo />
        <ProductJourney />
        <Numbers />
        <Pricing />
        <OpenSource />
        <Faq />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
