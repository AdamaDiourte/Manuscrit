export type TimeBudget = {
  weeks: number;
  hoursPerWeek: number;
  totalHours: number;
  label: string;
};

const WEEKS: Record<string, number> = {
  lt3m: 10,
  "3to6m": 20,
  "6to12m": 40,
  gt1y: 70,
  gt3y: 150,
};

const HOURS_PER_WEEK: Record<string, number> = {
  lt5: 3,
  "5to10": 7,
  "10to20": 15,
  fulltime: 35,
};

/** Budget de temps calculé à partir du délai et du temps hebdomadaire. */
export function computeTimeBudget(
  answers: Record<string, unknown>,
): TimeBudget {
  const deadline =
    typeof answers.deadline_range === "string" ? answers.deadline_range : "";
  const weekly =
    typeof answers.weekly_time === "string" ? answers.weekly_time : "";
  const weeks = WEEKS[deadline] ?? 20;
  const hoursPerWeek = HOURS_PER_WEEK[weekly] ?? 7;
  const totalHours = weeks * hoursPerWeek;
  return {
    weeks,
    hoursPerWeek,
    totalHours,
    label: `environ ${weeks} semaines × ${hoursPerWeek} h ≈ ${totalHours} h`,
  };
}
