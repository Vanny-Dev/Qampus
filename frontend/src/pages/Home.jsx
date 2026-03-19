import { useState, useEffect, useRef } from "react";
import { queueAPI, studentsAPI } from "../services/api";
import { SOCKET_EVENTS } from "../services/socket";
import useSocket from "../hooks/useSocket";
import useQueue from "../hooks/useQueue";
import Button from "../components/common/Button";
import { useToast } from "../components/common/Toast";
import styles from "./Home.module.css";
import useNotifications from "../hooks/useNotifications";
import { LucideMessageCircleWarning } from "lucide-react"

// ─── Feature flags ───────────────────────────────────────────────────────────
const QUEUE_OPEN = import.meta.env.VITE_GET_MY_TICKET !== "false"; // default open

// ─── Audio & Vibration ───────────────────────────────────────────────────────
const playBeep = (type = "alert") => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const configs = {
      warning: [
        { freq: 520, start: 0,    duration: 0.18, gain: 0.35 },
        { freq: 680, start: 0.22, duration: 0.18, gain: 0.35 },
      ],
      alert: [
        { freq: 880, start: 0,    duration: 0.15, gain: 0.6 },
        { freq: 880, start: 0.2,  duration: 0.15, gain: 0.6 },
        { freq: 1100,start: 0.4,  duration: 0.25, gain: 0.7 },
      ],
    };
    const tones = configs[type] || configs.alert;
    tones.forEach(({ freq, start, duration, gain }) => {
      const oscillator = ctx.createOscillator();
      const gainNode   = ctx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(freq, ctx.currentTime + start);
      gainNode.gain.setValueAtTime(0, ctx.currentTime + start);
      gainNode.gain.linearRampToValueAtTime(gain, ctx.currentTime + start + 0.02);
      gainNode.gain.linearRampToValueAtTime(0,    ctx.currentTime + start + duration);
      oscillator.start(ctx.currentTime + start);
      oscillator.stop(ctx.currentTime + start + duration + 0.05);
    });
    setTimeout(() => ctx.close(), (tones[tones.length - 1].start + 1) * 1000);
  } catch (e) {
    console.warn("Audio not supported:", e);
  }
};

const vibrate = (pattern) => {
  if ("vibrate" in navigator) navigator.vibrate(pattern);
};

const speakAlert = (ticketNumber, windowNum) => {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const text = `Please proceed to Cashier Window ${windowNum}.`;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "en-PH";
  utter.rate = 0.9;
  utter.pitch = 1;
  utter.volume = 1;
  window.speechSynthesis.speak(utter);
};

const speakWarning = (text) => {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "en-PH";
  utter.rate = 0.9;
  utter.pitch = 1;
  utter.volume = 0.8;
  window.speechSynthesis.speak(utter);
};

const notifyWarning = () => {
  playBeep("warning");
  vibrate([200, 100, 200]);
};

const notifyAlert = (ticket) => {
  // When called to window: speech only, no beep or vibration
  if (ticket) {
    speakAlert(ticket.ticketNumber, ticket.counter || 1);
  } else {
    // Fallback if no ticket info
    playBeep("alert");
    vibrate([400, 150, 400, 150, 600]);
  }
};

// ─── Feedback Modal ───────────────────────────────────────────────────────────
const FeedbackModal = ({ ticketId, onClose }) => {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const { addToast } = useToast();
  const { requestPermission } = useNotifications();

  useEffect(() => { requestPermission(); }, []);

  const handleSubmit = async () => {
    if (!rating) return;
    setLoading(true);
    try {
      await queueAPI.feedback(ticketId, { rating, comment });
      addToast("Thank you for your feedback!", "success");
      onClose();
    } catch {
      addToast("Could not submit feedback.", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modal}>
        <div className={styles.modalEmoji}>🎉</div>
        <h2 className={styles.modalTitle}>Transaction Complete!</h2>
        <p className={styles.modalSub}>How was your experience today?</p>
        <div className={styles.stars}>
          {[1, 2, 3, 4, 5].map((s) => (
            <button key={s} className={`${styles.star} ${rating >= s ? styles.starFilled : ""}`} onClick={() => setRating(s)}>★</button>
          ))}
        </div>
        <textarea
          className={styles.feedbackInput}
          placeholder="Any comments? (optional)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
        />
        <div className={styles.modalActions}>
          <Button variant="primary" onClick={handleSubmit} loading={loading} disabled={!rating} fullWidth>Submit Feedback</Button>
          <Button variant="ghost" onClick={onClose} fullWidth>Skip</Button>
        </div>
      </div>
    </div>
  );
};

// ─── My Ticket ────────────────────────────────────────────────────────────────
const MyTicket = ({ ticket, position, onLeave }) => {
  const isCalled = ticket.status === "called" || ticket.status === "serving";
  const estimatedWait = position > 1 ? `~${(position - 1) * 3} min` : "Next up!";
  const estMinutes = (position - 1) * 3;
  const isWarning = !isCalled && position > 1 && estMinutes <= 2;

  return (
    <div className={`${styles.myTicket} ${isCalled ? styles.ticketCalled : ""}`}>
      {isCalled && (
        <div className={styles.calledBanner}>
          <span className={styles.calledPulse} />
          <div>
            <div className={styles.calledTitle}>🔔 It's your turn!</div>
            <div className={styles.calledCounter}>
              Please proceed to <strong>Cashier Window {ticket.counter || "1"}</strong>
            </div>
          </div>
        </div>
      )}

      <div className={styles.ticketHeader}>
        <span className={styles.ticketLabel}>YOUR TICKET</span>
        <span className={`${styles.ticketStatus} ${isCalled ? styles.statusCalled : styles.statusWaiting}`}>
          {isCalled ? "Called" : "Waiting"}
        </span>
      </div>

      <div className={styles.ticketNumber}>#{String(ticket.ticketNumber).padStart(3, "0")}</div>
      <div className={styles.ticketName}>{ticket.name}</div>
      <div className={styles.ticketTx}>Student No. {ticket.transactionType}</div>

      {isWarning && (
        <div className={styles.warningBanner}>
          <span className={styles.warningPulse} />
          ⚠️ About 2 minutes left — start making your way to the cashier!
        </div>
      )}

      <div className={styles.ticketStats}>
        <div className={styles.ticketStat}>
          <div className={styles.statVal}>{isCalled ? "NOW" : position || "—"}</div>
          <div className={styles.statLbl}>Position</div>
        </div>
        <div className={styles.ticketStatDivider} />
        <div className={styles.ticketStat}>
          <div className={styles.statVal}>{isCalled ? `W${ticket.counter || 1}` : estimatedWait}</div>
          <div className={styles.statLbl}>{isCalled ? "Window" : "Est. Wait"}</div>
        </div>
      </div>
    </div>
  );
};

// ─── Home Page ────────────────────────────────────────────────────────────────
export default function HomePage() {
  const [studentNo, setStudentNo] = useState("");
  const [studentName, setStudentName] = useState("");
  const [studentNoError, setStudentNoError] = useState("");
  const [studentValid, setStudentValid] = useState(false);
  const [validating, setValidating] = useState(false);

  const [myTicket, setMyTicket] = useState(() => {
    try {
      const saved = localStorage.getItem("qampus_ticket");
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [myPosition, setMyPosition] = useState(null);
  const [joining, setJoining] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [servedTicketId, setServedTicketId] = useState(null);
  const notifiedRef = useRef({ thirdInLine: false, warning: false, alert: false });

  useEffect(() => {
    if (myTicket) localStorage.setItem("qampus_ticket", JSON.stringify(myTicket));
    else localStorage.removeItem("qampus_ticket");
  }, [myTicket]);

  const { waiting, loading } = useQueue();
  const { addToast } = useToast();
  const { requestPermission, sendNotification } = useNotifications();

  useEffect(() => { requestPermission(); }, []);

  // ── Live debounced student number validation ──────────────────────────────
  useEffect(() => {
    if (!studentNo.trim()) {
      setStudentValid(false);
      setStudentName("");
      setStudentNoError("");
      setValidating(false);
      return;
    }

    setValidating(true);
    const timer = setTimeout(async () => {
      try {
        const res = await studentsAPI.validate(studentNo.trim());
        setStudentValid(true);
        setStudentName(res.data.name);
        setStudentNoError("");
      } catch (err) {
        setStudentValid(false);
        setStudentName("");
        setStudentNoError(err.response?.data?.message || "Student ID not found.");
      } finally {
        setValidating(false);
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [studentNo]);

  // ── Poll my ticket status ─────────────────────────────────────────────────
  useEffect(() => {
    if (!myTicket) return;
    const poll = async () => {
      try {
        const res = await queueAPI.getTicket(myTicket._id);
        const { ticket, position } = res.data;
        setMyTicket(ticket);
        setMyPosition(position);

        const estMinutes = (position - 1) * 3;
        if (ticket.status === "called") {
          if (!notifiedRef.current.alert) {
            notifiedRef.current.alert = true;
            notifyAlert(ticket);
            sendNotification("NOTIFY_CALLED", { message: `Please proceed to Cashier Window ${ticket.counter || ""}.` });
          }
        } else {
          if (position === 3 && !notifiedRef.current.thirdInLine) {
            notifiedRef.current.thirdInLine = true;
            notifyWarning();
            speakWarning("Please get ready. You are 3rd in line.");
            addToast("⚠️ You are 3rd in line — get ready!", "warning");
            sendNotification("NOTIFY_THIRD");
          }
          if (estMinutes <= 2 && position > 1 && !notifiedRef.current.warning) {
            notifiedRef.current.warning = true;
            notifyWarning();
            speakWarning("Please be ready. You are almost next in line.");
            sendNotification("NOTIFY_WARNING");
          }
        }

        if (ticket.status === "served") {
          setServedTicketId(ticket._id);
          setShowFeedback(true);
          setMyTicket(null);
        } else if (ticket.status === "skipped") {
          addToast("Your ticket was skipped. Please approach the cashier to rejoin.", "warning");
          setMyTicket(null);
        }
      } catch (err) {
        if (err?.response?.status === 404) {
          setMyTicket(null);
          addToast("Your ticket is no longer active.", "warning");
        }
      }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [myTicket?._id]);

  // ── Socket events ─────────────────────────────────────────────────────────
  useSocket({
    ticketId: myTicket?._id,
    listeners: {
      [SOCKET_EVENTS.TICKET_CALLED]: ({ ticket }) => {
        if (ticket._id === myTicket?._id) {
          setMyTicket(ticket);
          notifyAlert(ticket);
          sendNotification("NOTIFY_CALLED", { message: `Please proceed to Cashier Window ${ticket.counter || ""}.` });
          addToast(`🔔 It's your turn! Proceed to Cashier Window ${ticket.counter || 1}.`, "alert", 8000);
        }
      },
      [SOCKET_EVENTS.TICKET_SERVED]: ({ ticket }) => {
        if (ticket._id === myTicket?._id) {
          setServedTicketId(ticket._id);
          setShowFeedback(true);
          setMyTicket(null);
        }
      },
      [SOCKET_EVENTS.TICKET_SKIPPED]: ({ ticket }) => {
        if (ticket._id === myTicket?._id) {
          addToast("Your ticket was skipped.", "warning");
          setMyTicket(null);
        }
      },
      [SOCKET_EVENTS.QUEUE_UPDATED]: ({ queue }) => {
        if (!myTicket || !queue) return;
        const updated = queue.find((q) => q._id === myTicket._id);
        if (updated) {
          setMyTicket(updated);
          const waitingOnly = queue.filter((q) => q.status === "waiting");
          const idx = waitingOnly.findIndex((q) => q._id === myTicket._id);
          const newPosition = idx + 1;
          setMyPosition(newPosition);
          if (newPosition === 3 && !notifiedRef.current.thirdInLine) {
            notifiedRef.current.thirdInLine = true;
            notifyWarning();
            speakWarning("Please get ready. You are 3rd in line.");
            addToast("⚠️ You are 3rd in line — get ready!", "warning");
            sendNotification("NOTIFY_THIRD");
          }
          const estMins = (newPosition - 1) * 3;
          if (estMins <= 2 && newPosition > 1 && !notifiedRef.current.warning) {
            notifiedRef.current.warning = true;
            notifyWarning();
            speakWarning("Please be ready. You are almost next in line.");
            sendNotification("NOTIFY_WARNING");
          }
        }
      },
    },
  });

  // ── Join queue ────────────────────────────────────────────────────────────
  const handleJoin = async () => {
    if (!studentValid) return;
    setJoining(true);
    try {
      const res = await queueAPI.join({ name: studentName || "Anonymous", transactionType: studentNo.trim() });
      notifiedRef.current = { thirdInLine: false, warning: false, alert: false };
      setMyTicket(res.data.ticket);
      addToast(`Ticket #${String(res.data.ticket.ticketNumber).padStart(3, "0")} — You've joined the queue!`, "success");
      setStudentNo("");
      setStudentName("");
      setStudentNoError("");
      setStudentValid(false);
    } catch (err) {
      addToast(err.response?.data?.message || "Could not join queue.", "error");
    } finally {
      setJoining(false);
    }
  };

  const handleLeave = async () => {
    if (!myTicket) return;
    try { await queueAPI.skip(myTicket._id); } catch {/* may already be gone */}
    setMyTicket(null);
    addToast("You've left the queue.", "info");
  };

  return (
    <div className={styles.page}>
      {/* Hero */}
      <section className={styles.hero}>
        <div className={styles.heroGlow} />
        <div className={styles.heroGlowLeft} />
        <div className={styles.heroGlowRight} />
        <div className={styles.heroContent}>
          <div className={styles.heroBadge}>NCF Cashier's Office</div>
          <h1 className={styles.heroTitle}>
            Skip the line.<br />
            <span className={styles.heroAccent}>Queue smarter.</span>
          </h1>
          <p className={styles.heroSub}>
            Join the virtual queue from anywhere on campus. Get notified when it's your turn.
          </p>
        </div>
        <div className={styles.liveStrip}>
          <div className={styles.liveTag}>
            <span className={styles.liveDot} />
            LIVE
          </div>
          <span className={styles.liveText}>
            <strong>{loading ? "—" : waiting.length}</strong> currently waiting
          </span>
        </div>
      </section>

      {/* Main */}
      <div className={styles.main}>
        <div className={styles.left}>
          {myTicket ? (
            <MyTicket ticket={myTicket} position={myPosition} onLeave={handleLeave} />
          ) : (
            <div className={styles.joinCard}>
              <h2 className={styles.joinTitle}>Join the Queue</h2>
              <p className={styles.joinSub}>Enter your Student No. to get a virtual ticket</p>
              <div className={styles.form}>

                {/* Student No. */}
                <div className={styles.field}>
                  <label className={styles.label}>Student No. <span className={styles.required}>*</span></label>
                  <div className={styles.inputWithStatus}>
                    <input
                      className={`${styles.input} ${studentNoError ? styles.inputError : studentValid ? styles.inputValid : ""}`}
                      type="text"
                      placeholder="e.g. 00-00000"
                      value={studentNo}
                      onChange={(e) => {
                        setStudentNo(e.target.value);
                        setStudentNoError("");
                        setStudentValid(false);
                        setStudentName("");
                        if (e.target.value.trim()) setValidating(true);
                        else setValidating(false);
                      }}
                      onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                      autoComplete="off"
                    />
                    {validating && <span className={styles.inputSpinner} />}
                    {!validating && studentValid && <span className={styles.inputCheck}>✓</span>}
                    {!validating && studentNoError && studentNo && <span className={styles.inputX}>✗</span>}
                  </div>
                  {validating && <span className={styles.fieldHint}>🔍 Looking for this ID…</span>}
                  {!validating && studentNoError && <span className={styles.fieldError}>{studentNoError}</span>}
                  {/* {!validating && studentValid && studentName && <span className={styles.fieldSuccess}>✓ {studentName}</span>} */}
                </div>

                {/* Full Name — disabled, auto-filled */}
                <div className={styles.field}>
                  <label className={styles.label}>Full Name</label>
                  <input
                    className={`${styles.input} ${styles.inputDisabled}`}
                    type="text"
                    placeholder="Auto-filled from Student ID"
                    value={studentName}
                    disabled
                    readOnly
                  />
                </div>

                {!QUEUE_OPEN && (
                  <div className={styles.queueClosed}>
                    <LucideMessageCircleWarning size={16} />
                    Queue is closed for now.
                  </div>
                )}
                <Button
                  variant="primary"
                  size="lg"
                  onClick={handleJoin}
                  loading={joining}
                  disabled={!studentValid || validating || !QUEUE_OPEN}
                  fullWidth
                >
                  Get My Ticket →
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Live queue */}
        <div className={styles.right}>
          <div className={styles.queueCard}>
            <div className={styles.queueHeader}>
              <h3 className={styles.queueTitle}>Live Queue</h3>
              <span className={styles.queueCount}>{waiting.length} waiting</span>
            </div>
            <div className={styles.queueList}>
              {loading && <p className={styles.empty}>Loading…</p>}
              {!loading && waiting.length === 0 && (
                <div className={styles.emptyState}>
                  <div className={styles.emptyIcon}>✓</div>
                  <p>Queue is empty right now</p>
                </div>
              )}
              {waiting.slice(0, 10).map((q, i) => (
                <div
                  key={q._id}
                  className={`${styles.queueRow} ${myTicket && q._id === myTicket._id ? styles.myRow : ""}`}
                >
                  <div className={styles.rowNum} style={{ color: i === 0 ? "#10B981" : "#F5A623" }}>
                    #{String(q.ticketNumber).padStart(3, "0")}
                  </div>
                  <div className={styles.rowInfo}>
                    <div className={styles.rowName}>{q.name}</div>
                    <div className={styles.rowTx}>{q.transactionType}</div>
                  </div>
                  <div className={styles.rowPos}>#{i + 1}</div>
                  {myTicket && q._id === myTicket._id && (
                    <span className={styles.youBadge}>You</span>
                  )}
                </div>
              ))}
              {waiting.length > 10 && (
                <p className={styles.moreText}>+{waiting.length - 10} more in queue</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {showFeedback && (myTicket || servedTicketId) && (
        <FeedbackModal
          ticketId={servedTicketId || myTicket?._id}
          onClose={() => { setShowFeedback(false); setServedTicketId(null); }}
        />
      )}
    </div>
  );
}