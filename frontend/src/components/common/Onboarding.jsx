import { useState } from "react";
import { Handshake, Ticket, Bell, ArrowRightToLine } from "lucide-react";
import styles from "./Onboarding.module.css";
import Button from "./Button";

const STEPS = [
  {
    icon: Handshake,
    color: "#F5A623",
    title: "Welcome to Qampus",
    desc: "The virtual queuing system for NCF Cashier's Office. No more standing in long lines!",
  },
  {
    icon: Ticket,
    color: "#10B981",
    title: "Get Your Ticket",
    desc: "Enter your Student ID to get a virtual ticket number. You can wait anywhere on campus.",
  },
  {
    icon: Bell,
    color: "#818CF8",
    title: "Get Notified",
    desc: "We'll alert you with sound and speech when it's your turn. Keep this page open on your phone.",
  },
  {
    icon: ArrowRightToLine,
    color: "#38BDF8",
    title: "Proceed to Window",
    desc: "When called, go to the cashier window shown on your ticket. That's it — easy!",
  },
];

export default function Onboarding({ onDone }) {
  const [step, setStep] = useState(0);
  const [exiting, setExiting] = useState(false);

  const isLast = step === STEPS.length - 1;
  const { icon: Icon, color, title, desc } = STEPS[step];

  const next = () => {
    if (isLast) {
      setExiting(true);
      setTimeout(() => {
        localStorage.setItem("qampus_onboarded", "true");
        onDone();
      }, 400);
    } else {
      setStep((s) => s + 1);
    }
  };

  const skip = () => {
    setExiting(true);
    setTimeout(() => {
      localStorage.setItem("qampus_onboarded", "true");
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