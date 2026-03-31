import { useState, useEffect, useRef } from "react";
import { boardAPI, windowsAPI } from "../services/api";
import { connectSocket } from "../services/socket";
import styles from "./QueueBoard.module.css";

const TOTAL_WINDOWS = 5;

const speakCall = (ticketNumber, windowNum) => {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const num = String(ticketNumber).padStart(3, "0");
  // Speak each digit separately for clarity
  const digits = num.split("").join(", ");
  const text = `Ticket number ${digits}. Please proceed to Cashier Window ${windowNum}. Thank you.`;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "en-PH";
  utter.rate = 0.85;
  utter.pitch = 1.05;
  utter.volume = 1;
  window.speechSynthesis.speak(utter);
};

export default function QueueBoard() {
  const [board, setBoard] = useState({});
  const [activeWindows, setActiveWindows] = useState({});
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState({}); // { windowNum: true } for highlight animation
  const prevBoard = useRef({});

  const fetchBoard = async () => {
    try {
      const [boardRes, windowsRes] = await Promise.all([
        boardAPI.getBoard(),
        windowsAPI.getActive()
      ]);
      setBoard(boardRes.data.board || {});
      setActiveWindows(windowsRes.data.activeWindows || {});
    } catch (err) {
      console.error("Board fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBoard();

    const socket = connectSocket();
    socket.emit("join:queue-room"); // Join the global queue room to receive updates

    socket.on("board:updated", ({ board: newBoard }) => {
      // Detect which window changed and flash + speak
      Object.keys(newBoard).forEach((w) => {
        const prev = prevBoard.current[w];
        const curr = newBoard[w];
        if (curr && (!prev || prev._id !== curr._id)) {
          // New ticket called at this window
          speakCall(curr.ticketNumber, w);
          setFlash((f) => ({ ...f, [w]: true }));
          setTimeout(() => setFlash((f) => ({ ...f, [w]: false })), 2000);
        }
      });
      prevBoard.current = newBoard;
      setBoard(newBoard);
    });

    socket.on("windows:updated", ({ activeWindows: newActiveWindows }) => {
      setActiveWindows(newActiveWindows || {});
    });

    return () => {
      socket.off("board:updated");
      socket.off("windows:updated");
    };
  }, []);

  // Track board changes for ref
  useEffect(() => {
    prevBoard.current = board;
  }, [board]);

  // Live clock without refreshing the page every second
    const [now, setNow] = useState(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    useEffect(() => {
        const interval = setInterval(() => {
            setNow(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
        }, 1000); // Update every minute
        return () => clearInterval(interval);
    }, []);

  return (
    <div className={styles.page}>
      {/* Background glow */}
      <div className={styles.bgGlow} />

      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerRight}>
          <div className={styles.liveDot} />
          <span className={styles.liveLabel}>LIVE</span>
          <span className={styles.clock}>{now}</span>
        </div>
      </header>

      {/* Title */}
      <div className={styles.titleWrap}>
        <h1 className={styles.title}>Now Serving</h1>
        <p className={styles.subtitle}>Please listen for your ticket number</p>
      </div>

      {/* Windows grid */}
      {loading ? (
        <div className={styles.loadingWrap}>
          <div className={styles.spinner} />
          <p>Loading board…</p>
        </div>
      ) : (
        <div className={styles.grid}>
          {Array.from({ length: TOTAL_WINDOWS }, (_, i) => i + 1).map((w) => {
            const ticket = board[w];
            const isActive = !!ticket;
            const isFlashing = flash[w];

            return (
              <div
                key={w}
                className={`${styles.window} ${isActive ? styles.windowActive : styles.windowIdle} ${isFlashing ? styles.windowFlash : ""}`}
              >
                <div className={styles.windowLabel}>Window {w}</div>
                <div className={styles.windowNum}>
                  {isActive
                    ? `#${String(ticket.ticketNumber).padStart(3, "0")}`
                    : "—"}
                </div>
                {isActive && (
                  <div className={styles.windowName}>{ticket.name}</div>
                )}
                <div className={`${styles.windowStatus} ${isActive ? styles.statusCalled : styles.statusIdle}`}>
                  {isActive ? (
                    <><span className={styles.pulseDot} /> Serving</>
                  ) : "Available"}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <footer className={styles.footer}>
        <p>Please wait to be called. Keep this page open to hear announcements.</p>
      </footer>
    </div>
  );
}