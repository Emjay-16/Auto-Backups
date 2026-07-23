import styles from "@/styles/components/RobotGroupBadge.module.css";

type RobotGroupBadgeProps = {
  group: string;
  variant?: "badge" | "avatar";
};

export function RobotGroupBadge({ group, variant = "badge" }: RobotGroupBadgeProps) {
  const tone = robotGroupTone(group);
  return (
    <span className={`${styles[variant]} ${styles[tone]}`}>
      <i aria-hidden="true" />
      <b>{group}</b>
    </span>
  );
}

export function robotGroupTone(group: string): "amr" | "smr" | "smrl" | "defaultTone" {
  const normalized = group.trim().toUpperCase();
  if (normalized === "SMRL") return "smrl";
  if (normalized === "SMR") return "smr";
  if (normalized === "AMR") return "amr";
  return "defaultTone";
}
