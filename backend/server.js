require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

// ─── CORS Configuration (RAILWAY OPTIMIZED) ──────────────────────────────────
const corsOptions = {
  origin: true,
  credentials: true,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["Content-Length"],
  maxAge: 86400,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ─── Socket.io ────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  },
  transports: ["websocket", "polling"],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
});

const activeWindows = new Map();

const broadcastActiveWindows = () => {
  const windows = {};
  activeWindows.forEach((info, windowNum) => {
    windows[windowNum] = info.cashierName;
  });
  io.emit("windows:updated", { activeWindows: windows });
};

io.on("connection", (socket) => {
  console.log("✅ Socket connected:", socket.id);

  socket.on("join:queue-room", () => socket.join("queue:global"));
  socket.on("join:counter-room", (counter) => socket.join(`counter:${counter}`));
  socket.on("leave:counter-room", (counter) => socket.leave(`counter:${counter}`));

  socket.on("claim:window", ({ windowNum, cashierName }) => {
    activeWindows.forEach((info, num) => {
      if (info.socketId === socket.id) activeWindows.delete(num);
    });
    activeWindows.set(windowNum, { socketId: socket.id, cashierName });
    socket.join(`counter:${windowNum}`);
    broadcastActiveWindows();
  });

  socket.on("release:window", ({ windowNum }) => {
    const info = activeWindows.get(windowNum);
    if (info && info.socketId === socket.id) {
      activeWindows.delete(windowNum);
      socket.leave(`counter:${windowNum}`);
      broadcastActiveWindows();
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ Socket disconnected:", socket.id);
    activeWindows.forEach((info, num) => {
      if (info.socketId === socket.id) activeWindows.delete(num);
    });
    broadcastActiveWindows();
  });

  socket.on("join:ticket-room", (id) => socket.join(`ticket:${id}`));
  socket.on("leave:ticket-room", (id) => socket.leave(`ticket:${id}`));

  const windows = {};
  activeWindows.forEach((info, windowNum) => {
    windows[windowNum] = info.cashierName;
  });
  socket.emit("windows:updated", { activeWindows: windows });
});

app.get("/api/windows/active", (req, res) => {
  const windows = {};
  activeWindows.forEach((info, windowNum) => {
    windows[windowNum] = info.cashierName;
  });
  res.json({ activeWindows: windows });
});

const getBoardData = async () => {
  const TOTAL_WINDOWS = 5;
  const board = {};
  for (let w = 1; w <= TOTAL_WINDOWS; w++) {
    const ticket = await Queue.findOne({
      serviceDate: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }),
      counter: w,
      status: { $in: ["called", "serving"] },
    }).sort({ calledAt: -1 });
    board[w] = ticket || null;
  }
  return board;
};

const emit = {
  queueUpdated: (data) => io.to("queue:global").emit("queue:updated", data),
  ticketCalled: (ticketId, counter, data) => {
    io.to(`ticket:${ticketId}`).emit("ticket:called", data);
    io.to(`counter:${counter}`).emit("counter:updated", data);
    io.to("queue:global").emit("queue:updated", data);
  },
  ticketServed: (ticketId, counter, data) => {
    io.to(`ticket:${ticketId}`).emit("ticket:served", data);
    io.to(`counter:${counter}`).emit("counter:updated", data);
    io.to("queue:global").emit("queue:updated", data);
  },
  ticketSkipped: (ticketId, counter, data) => {
    io.to(`ticket:${ticketId}`).emit("ticket:skipped", data);
    io.to(`counter:${counter}`).emit("counter:updated", data);
    io.to("queue:global").emit("queue:updated", data);
  },
  analyticsUpdated: (data) => io.to("queue:global").emit("analytics:updated", data),
};

// ─── MongoDB ──────────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/qampus")
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => { console.error("❌ MongoDB error:", err.message); process.exit(1); });

// ─── Student Model ────────────────────────────────────────────────────────────
const studentSchema = new mongoose.Schema({
  studentNo: { type: String, required: true, unique: true, trim: true, uppercase: true },
  name: { type: String, required: true, trim: true },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

const Student = mongoose.models.Student || mongoose.model("Student", studentSchema);

// ─── User Model ───────────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 6, select: false },
  role: { type: String, enum: ["cashier", "admin"], default: "cashier" },
  counter: { type: Number, default: 1 },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});
userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

const User = mongoose.models.User || mongoose.model("User", userSchema);

// ─── Queue Model ──────────────────────────────────────────────────────────────
const STATUS = { WAITING: "waiting", CALLED: "called", SERVING: "serving", SERVED: "served", SKIPPED: "skipped", PAUSED: "paused" };

const queueSchema = new mongoose.Schema({
  ticketNumber: { type: Number, required: true },
  name: { type: String, required: true, trim: true },
  transactionType: { type: String, required: true, trim: true },
  status: { type: String, enum: Object.values(STATUS), default: STATUS.WAITING },
  counter: { type: Number, default: null },
  servedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  calledAt: { type: Date, default: null },
  servedAt: { type: Date, default: null },
  serviceDate: { type: String, default: () => new Date().toISOString().split("T")[0] },
  feedback: {
    rating: { type: Number, min: 1, max: 5, default: null },
    comment: { type: String, default: "" },
    submittedAt: { type: Date, default: null },
  },
  pausedAt: { type: Date, default: null },
}, { timestamps: true });

queueSchema.index({ serviceDate: 1, status: 1 });
const Queue = mongoose.models.Queue || mongoose.model("Queue", queueSchema);

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

const getTodayQueue = () =>
  Queue.find({ serviceDate: today(), status: { $in: [STATUS.WAITING, STATUS.CALLED, STATUS.SERVING] } })
    .sort({ ticketNumber: 1 });

const getWaitingQueue = () =>
  Queue.find({ serviceDate: today(), status: { $in: [STATUS.WAITING] } })
    .sort({ ticketNumber: 1 });

const getCounterQueue = (counter) =>
  Queue.find({ serviceDate: today(), counter, status: { $in: [STATUS.CALLED, STATUS.SERVING] } })
    .sort({ ticketNumber: 1 });

const generateTicketNumber = async () => {
  const last = await Queue.findOne({ serviceDate: today() }).sort({ ticketNumber: -1 });
  return last ? last.ticketNumber + 1 : 1;
};

const getAnalyticsSnapshot = async () => {
  const d = today();
  const [waiting, called, served, skipped, avgData] = await Promise.all([
    Queue.countDocuments({ serviceDate: d, status: STATUS.WAITING }),
    Queue.countDocuments({ serviceDate: d, status: { $in: [STATUS.CALLED, STATUS.SERVING] } }),
    Queue.countDocuments({ serviceDate: d, status: STATUS.SERVED }),
    Queue.countDocuments({ serviceDate: d, status: STATUS.SKIPPED }),
    Queue.aggregate([
      { $match: { serviceDate: d, status: STATUS.SERVED, servedAt: { $ne: null } } },
      { $project: { w: { $divide: [{ $subtract: ["$servedAt", "$createdAt"] }, 1000] } } },
      { $group: { _id: null, avg: { $avg: "$w" } } },
    ]),
  ]);
  return { waiting, called, served, skipped, avgWaitSeconds: avgData[0] ? Math.round(avgData[0].avg) : 0 };
};

// ─── App Middleware ───────────────────────────────────────────────────────────
app.use(express.json());

const protect = async (req, res, next) => {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) return res.status(401).json({ message: "Unauthorized. No token." });
    const decoded = jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET || "qampus_secret");
    const user = await User.findById(decoded.id);
    if (!user || !user.isActive) return res.status(401).json({ message: "Unauthorized." });
    req.user = user;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") return res.status(401).json({ message: "Token expired." });
    return res.status(401).json({ message: "Invalid token." });
  }
};

const signToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET || "qampus_secret", { expiresIn: process.env.JWT_EXPIRES_IN || "8h" });

// ─── Auth Routes ──────────────────────────────────────────────────────────────
app.post("/api/auth/login", async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: "Username and password required." });
    const user = await User.findOne({ username }).select("+password");
    if (!user || !(await user.comparePassword(password))) return res.status(401).json({ message: "Invalid credentials." });
    if (!user.isActive) return res.status(403).json({ message: "Account deactivated." });
    res.json({ message: "Login successful", token: signToken(user._id), user: user.toJSON() });
  } catch (err) { next(err); }
});

app.get("/api/auth/me", protect, (req, res) => res.json({ user: req.user }));

app.post("/api/auth/register", async (req, res, next) => {
  try {
    if (process.env.ALLOW_SIGNUP !== "true") return res.status(403).json({ message: "Registration is currently closed." });
    const { name, username, password, confirmPassword, counter } = req.body;
    if (!name || !username || !password) return res.status(400).json({ message: "Name, username, and password are required." });
    if (password !== confirmPassword) return res.status(400).json({ message: "Passwords do not match." });
    if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters." });
    const existing = await User.findOne({ username: username.toLowerCase() });
    if (existing) return res.status(409).json({ message: "Username already taken." });
    const user = await User.create({
      name: name.trim(),
      username: username.toLowerCase().trim(),
      password,
      role: "cashier",
      counter: counter || 1,
    });
    res.status(201).json({ message: "Account created successfully!", token: signToken(user._id), user: user.toJSON() });
  } catch (err) { next(err); }
});

app.post("/api/auth/seed", async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === "production") return res.status(403).json({ message: "Not in production." });
    const existing = await User.findOne({ username: "cashier1" });
    if (existing) return res.json({ message: "Default cashier already exists.", user: existing });
    const user = await User.create({ name: "Cashier One", username: "cashier1", password: "cashier123", role: "cashier", counter: 1 });
    res.status(201).json({ message: "Created! Username: cashier1 | Password: cashier123", user });
  } catch (err) { next(err); }
});

// ─── Student Routes ───────────────────────────────────────────────────────────
app.get("/api/students/validate/:studentNo", async (req, res, next) => {
  try {
    const studentNo = req.params.studentNo.trim().toUpperCase();
    const student = await Student.findOne({ studentNo, isActive: true });
    if (!student) return res.status(404).json({ valid: false, message: "Student ID not found in our records." });
    res.json({ valid: true, name: student.name, studentNo: student.studentNo });
  } catch (err) { next(err); }
});

app.get("/api/students", protect, async (req, res, next) => {
  try {
    const students = await Student.find().sort({ studentNo: 1 });
    res.json({ students });
  } catch (err) { next(err); }
});

app.post("/api/students", protect, async (req, res, next) => {
  try {
    const { studentNo, name } = req.body;
    if (!studentNo || !name) return res.status(400).json({ message: "Student No. and name are required." });
    const existing = await Student.findOne({ studentNo: studentNo.trim().toUpperCase() });
    if (existing) return res.status(409).json({ message: "Student No. already exists." });
    const student = await Student.create({ studentNo: studentNo.trim().toUpperCase(), name: name.trim() });
    res.status(201).json({ message: "Student added.", student });
  } catch (err) { next(err); }
});

app.post("/api/students/bulk", protect, async (req, res, next) => {
  try {
    const { students } = req.body;
    if (!Array.isArray(students) || students.length === 0)
      return res.status(400).json({ message: "Provide an array of students." });
    const ops = students.map((s) => ({
      updateOne: {
        filter: { studentNo: s.studentNo.trim().toUpperCase() },
        update: { $set: { name: s.name.trim(), isActive: true } },
        upsert: true,
      },
    }));
    const result = await Student.bulkWrite(ops);
    res.json({ message: `Imported ${result.upsertedCount} new, updated ${result.modifiedCount}.` });
  } catch (err) { next(err); }
});

app.delete("/api/students/:id", protect, async (req, res, next) => {
  try {
    await Student.findByIdAndDelete(req.params.id);
    res.json({ message: "Student removed." });
  } catch (err) { next(err); }
});

// ─── Display Board Route ─────────────────────────────────────────────────────
// Returns currently active ticket per window (for the ViewAllQueues page)
app.get("/api/queues/board", async (req, res, next) => {
  try {
    const TOTAL_WINDOWS = 5;
    const board = {};
    for (let w = 1; w <= TOTAL_WINDOWS; w++) {
      const ticket = await Queue.findOne({
        serviceDate: today(),
        counter: w,
        status: { $in: [STATUS.CALLED, STATUS.SERVING] },
      }).sort({ calledAt: -1 });
      board[w] = ticket || null;
    }
    res.json({ board });
  } catch (err) { next(err); }
});

// ─── Queue Routes ─────────────────────────────────────────────────────────────
app.get("/api/queue", async (req, res, next) => {
  try { res.json({ queue: await getTodayQueue() }); }
  catch (err) { next(err); }
});

app.post("/api/queue/join", async (req, res, next) => {
  try {
    const { name, transactionType } = req.body;
    if (!transactionType) return res.status(400).json({ message: "Student No. is required." });

    const studentNo = transactionType.trim().toUpperCase();

    const studentNoRegex = /^\d{2}-\d{4,5}$/;
    if (!studentNoRegex.test(studentNo))
      return res.status(400).json({ message: "Invalid student number format. Use YY-XXXXX (e.g. 25-00343)." });

    const student = await Student.findOne({ studentNo, isActive: true });
    if (!student) return res.status(404).json({ message: "Student ID not found in our records." });

    const existing = await Queue.findOne({
      serviceDate: today(),
      transactionType: studentNo,
      status: { $in: [STATUS.WAITING, STATUS.CALLED, STATUS.SERVING] },
    });
    if (existing) return res.status(409).json({ message: "You are already in the queue today." });

    // Limit: max 3 ticket requests per student per day (any status)
    const todayCount = await Queue.countDocuments({
      serviceDate: today(),
      transactionType: studentNo,
    });
    if (todayCount >= 3) return res.status(429).json({ message: "You have reached the maximum of 3 queue requests for today." });

    const ticketNumber = await generateTicketNumber();
    const ticket = await Queue.create({
      ticketNumber,
      name: name?.trim() || student.name,
      transactionType: studentNo,
      serviceDate: today(),
    });

    const [queue, waitingQueue] = await Promise.all([getTodayQueue(), getWaitingQueue()]);
    emit.queueUpdated({ queue, waitingQueue });
    emit.analyticsUpdated(await getAnalyticsSnapshot());
    res.status(201).json({ message: "Joined queue!", ticket });
  } catch (err) { next(err); }
});

app.get("/api/queue/counter/:counter", protect, async (req, res, next) => {
  try {
    const counter = parseInt(req.params.counter);
    const [counterQueue, waitingQueue] = await Promise.all([
      getCounterQueue(counter),
      getWaitingQueue(),
    ]);
    res.json({ counterQueue, waitingQueue });
  } catch (err) { next(err); }
});

app.get("/api/queue/:id", async (req, res, next) => {
  try {
    const ticket = await Queue.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: "Ticket not found." });
    const ahead = await Queue.countDocuments({ serviceDate: today(), status: STATUS.WAITING, ticketNumber: { $lt: ticket.ticketNumber } });
    res.json({ ticket, position: ahead + 1 });
  } catch (err) { next(err); }
});

app.post("/api/queue/call-next", protect, async (req, res, next) => {
  try {
    const counter = req.body.counter || req.user.counter;
    const alreadyServing = await Queue.findOne({
      serviceDate: today(),
      counter,
      status: { $in: [STATUS.CALLED, STATUS.SERVING] },
    });
    if (alreadyServing) return res.status(400).json({ message: "Finish serving the current payor before calling the next one." });
    const nextTicket = await Queue.findOne({ serviceDate: today(), status: STATUS.WAITING }).sort({ ticketNumber: 1 });
    if (!nextTicket) return res.status(404).json({ message: "No waiting tickets." });
    nextTicket.status = STATUS.CALLED;
    nextTicket.calledAt = new Date();
    nextTicket.counter = counter;
    nextTicket.servedBy = req.user._id;
    await nextTicket.save();
    const [globalQueue, counterQueue, waitingQueue] = await Promise.all([
      getTodayQueue(), getCounterQueue(counter), getWaitingQueue(),
    ]);
    emit.ticketCalled(nextTicket._id.toString(), counter, {
      ticket: nextTicket,
      queue: globalQueue,
      counterQueue,
      waitingQueue,
      message: `Ticket #${String(nextTicket.ticketNumber).padStart(3, "0")} — Please proceed to Cashier Window ${counter}`,
    });
    emit.analyticsUpdated(await getAnalyticsSnapshot());
    const board = await getBoardData();
    io.emit("board:updated", { board });
    res.json({ message: "Next payor called.", ticket: nextTicket, counterQueue });
  } catch (err) { next(err); }
});

// Repeat call — re-emits ticket:called so payor gets speech notification again
app.post("/api/queue/:id/repeat", protect, async (req, res, next) => {
  try {
    const ticket = await Queue.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: "Ticket not found." });
    if (!["called", "serving"].includes(ticket.status))
      return res.status(400).json({ message: "Ticket is not currently called." });
    const counter = ticket.counter || req.user.counter;
    emit.ticketCalled(ticket._id.toString(), counter, {
      ticket,
      message: `Ticket #${String(ticket.ticketNumber).padStart(3, "0")} — Please proceed to Cashier Window ${counter}`,
    });
    res.json({ message: "Repeat call sent.", ticket });
  } catch (err) { next(err); }
});

app.patch("/api/queue/:id/serve", protect, async (req, res, next) => {
  try {
    const ticket = await Queue.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: "Ticket not found." });
    const counter = ticket.counter || req.user.counter;
    ticket.status = STATUS.SERVED;
    ticket.servedAt = new Date();
    await ticket.save();
    const [globalQueue, counterQueue, waitingQueue] = await Promise.all([
      getTodayQueue(), getCounterQueue(counter), getWaitingQueue(),
    ]);
    emit.ticketServed(ticket._id.toString(), counter, { ticket, queue: globalQueue, counterQueue, waitingQueue });
    emit.analyticsUpdated(await getAnalyticsSnapshot());
    const boardAfterServe = await getBoardData();
    io.emit("board:updated", { board: boardAfterServe });
    res.json({ message: "Served.", ticket, counterQueue });
  } catch (err) { next(err); }
});

app.patch("/api/queue/:id/skip", protect, async (req, res, next) => {
  try {
    const ticket = await Queue.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: "Ticket not found." });
    const counter = ticket.counter || req.user.counter;
    ticket.status = STATUS.SKIPPED;
    await ticket.save();
    const [globalQueue, counterQueue, waitingQueue] = await Promise.all([
      getTodayQueue(), getCounterQueue(counter), getWaitingQueue(),
    ]);
    emit.ticketSkipped(ticket._id.toString(), counter, { ticket, queue: globalQueue, counterQueue, waitingQueue });
    emit.analyticsUpdated(await getAnalyticsSnapshot());
    res.json({ message: "Skipped.", ticket, counterQueue });
  } catch (err) { next(err); }
});

app.post("/api/queue/:id/feedback", async (req, res, next) => {
  try {
    const { rating, comment } = req.body;
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ message: "Rating must be 1–5." });
    const ticket = await Queue.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: "Ticket not found." });
    if (ticket.feedback.rating) return res.status(400).json({ message: "Feedback already submitted." });
    ticket.feedback = { rating, comment: comment || "", submittedAt: new Date() };
    await ticket.save();
    res.json({ message: "Feedback submitted!", ticket });
  } catch (err) { next(err); }
});

// ─── Analytics Routes ─────────────────────────────────────────────────────────
app.get("/api/analytics/today", protect, async (req, res, next) => {
  try {
    const d = today();
    const [waiting, called, served, skipped, feedbacks, avgData, hourly] = await Promise.all([
      Queue.countDocuments({ serviceDate: d, status: STATUS.WAITING }),
      Queue.countDocuments({ serviceDate: d, status: { $in: [STATUS.CALLED, STATUS.SERVING] } }),
      Queue.countDocuments({ serviceDate: d, status: STATUS.SERVED }),
      Queue.countDocuments({ serviceDate: d, status: STATUS.SKIPPED }),
      Queue.find({ serviceDate: d, "feedback.rating": { $ne: null } }).select("feedback"),
      Queue.aggregate([
        { $match: { serviceDate: d, status: STATUS.SERVED, servedAt: { $ne: null } } },
        { $project: { w: { $divide: [{ $subtract: ["$servedAt", "$createdAt"] }, 1000] } } },
        { $group: { _id: null, avg: { $avg: "$w" }, max: { $max: "$w" } } },
      ]),
      Queue.aggregate([
        { $match: { serviceDate: d } },
        { $group: {
          _id: { $hour: { date: "$createdAt", timezone: "Asia/Manila" } },
          count: { $sum: 1 }
        }},
        { $sort: { _id: 1 } },
      ]),
    ]);
    const avgRating = feedbacks.length > 0
      ? (feedbacks.reduce((s, f) => s + f.feedback.rating, 0) / feedbacks.length).toFixed(1)
      : null;
    const ratingBreakdown = [5,4,3,2,1].map((star) => ({
      star, count: feedbacks.filter((f) => f.feedback.rating === star).length,
    }));
    res.json({
      date: d,
      summary: {
        waiting, called, served, skipped,
        total: waiting + called + served + skipped,
        avgWaitSeconds: avgData[0] ? Math.round(avgData[0].avg) : 0,
        maxWaitSeconds: avgData[0] ? Math.round(avgData[0].max) : 0,
      },
      satisfaction: { avgRating: avgRating ? parseFloat(avgRating) : null, totalFeedbacks: feedbacks.length, ratingBreakdown },
      hourlyBreakdown: hourly.map((h) => ({ hour: h._id, count: h.count })),
    });
  } catch (err) { next(err); }
});

app.get("/api/analytics/history", protect, async (req, res, next) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const dates = Array.from({ length: days }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (days - 1 - i));
      return d.toISOString().split("T")[0];
    });
    const history = await Promise.all(dates.map(async (date) => {
      const [total, served, skipped] = await Promise.all([
        Queue.countDocuments({ serviceDate: date }),
        Queue.countDocuments({ serviceDate: date, status: STATUS.SERVED }),
        Queue.countDocuments({ serviceDate: date, status: STATUS.SKIPPED }),
      ]);
      return { date, total, served, skipped };
    }));
    res.json({ history });
  } catch (err) { next(err); }
});

// ─── Health & Error ───────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => res.json({ status: "ok", app: "Qampus" }));

app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ message: err.message || "Internal Server Error" });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Qampus running on http://localhost:${PORT}`);
  console.log(`📡 Socket.io ready`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`✅ CORS: Enabled for all origins with credentials`);
});