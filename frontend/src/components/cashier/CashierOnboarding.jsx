import { useState } from "react";
import { Handshake, List, Bell, CheckCircle } from "lucide-react";
import styles from "./CashierOnboarding.module.css";
import Button from "../common/Button";

const STEPS = [
  {
    icon: Handshake,
    color: "#F5A623",
    title: "Welcome to Qampus Cashier",
    desc: "Manage your queue efficiently with our virtual queuing system. Help students faster!",
  },
  {
    icon: List,
    color: "#10B981",
    title: "Monitor the Queue",
    desc: "View all waiting students in real-time. See their ticket numbers and wait times.",
  },
  {
    icon: Bell,
    color: "#818CF8",
    title: "Call Next Student",
    desc: "Click to notify the next student in line. They'll receive alerts on their device.",
  },
  {
    icon: CheckCircle,
    color: "#38BDF8",
    title: "Complete Service",
    desc: "Mark students as served when done. Keep the queue moving smoothly!",
  },
];

export default function CashierOnboarding({ onDone }) {
  const [step, setStep] = useState(0);
  const [exiting, setExiting] = useState(false);

  const isLast = step === STEPS.length - 1;
  const { icon: Icon, color, title, desc } = STEPS[step];

  const next = () => {
    if (isLast) {
      setExiting(true);
      setTimeout(() => {
        localStorage.setItem("qampus_cashier_onboarded", "true");
        onDone();
      }, 400);
    } else {
      setStep((s) => s + 1);
    }
  };

  const skip = () => {
    setExiting(true);
    setTimeout(() => {
      localStorage.setItem("qampus_cashier_onboarded", "true");
      onDone();
    }, 400);
  };

  return (
    <div className={`${styles.overlay} ${exiting ? styles.exiting : ""}`}>
      <div className={styles.card}>
        {!isLast && (
          <button className={styles.skip} onClick={skip}>Skip</button>
        )}

        <div className={styles.iconWrap} style={{ background: `${color}15`, border: `1px solid ${color}30` }}>
          <Icon size={36} color={color} strokeWidth={1.5} />
        </div>

        <h2 className={styles.title}>{title}</h2>
        <p className={styles.desc}>{desc}</p>

        <div className={styles.dots}>
          {STEPS.map((_, i) => (
            <span key={i} className={`${styles.dot} ${i === step ? styles.dotActive : ""}`}
              style={i === step ? { background: color } : {}} />
          ))}
        </div>

        <Button variant="primary" size="lg" onClick={next} fullWidth>
          {isLast ? "Get Started →" : "Next →"}
        </Button>
      </div>
    </div>
  );
}