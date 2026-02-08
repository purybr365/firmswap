import { Hero } from "@/components/landing/Hero";
import { WhyFirmSwap } from "@/components/landing/WhyFirmSwap";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Architecture } from "@/components/landing/Architecture";
import { Comparison } from "@/components/landing/Comparison";
import { ForSolvers } from "@/components/landing/ForSolvers";
import { ForIntegrators } from "@/components/landing/ForIntegrators";
import { Roadmap } from "@/components/landing/Roadmap";
import { Security } from "@/components/landing/Security";

export default function Home() {
  return (
    <>
      <Hero />
      <WhyFirmSwap />
      <HowItWorks />
      <Architecture />
      <Comparison />
      <ForSolvers />
      <ForIntegrators />
      <Security />
      <Roadmap />
    </>
  );
}
