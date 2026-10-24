import type { Metadata } from "next";
import RhymeTrainer from "@/components/rhyme_trainer";

export const metadata: Metadata = {
  title: "Treino de rimas — RapBeasts Studio",
};

export default function TrainPage() {
  return <RhymeTrainer />;
}
