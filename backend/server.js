import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

console.log("🚀 Server.js started");

// Load environment variables
dotenv.config({ path: ".env.local" });

const app = express();

const PORT = process.env.PORT || 5001;


// Middleware
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    credentials: true,
  })
);

app.use(express.json());


// MongoDB User Schema
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    collection: "users",
  }
);


const User = mongoose.model("User", userSchema);


// Health API
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Backend is running",
  });
});


// Get Users
app.get("/api/users", async (req, res) => {
  try {

    const users = await User.find();

    res.json(users);

  } catch (error) {

    res.status(500).json({
      message: error.message,
    });

  }
});


// Create User
app.post("/api/users", async (req, res) => {

  try {

    const user = await User.create(req.body);

    res.status(201).json(user);

  } catch (error) {

    res.status(400).json({
      message: error.message,
    });

  }

});

// Quiz and Attempt Schemas
const questionSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    options: [{ type: String }],
    correctOptionIndex: { type: Number, required: true },
    points: { type: Number, default: 1 },
  },
  { _id: true }
);

const quizSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: String,
    questions: [questionSchema],
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'quizzes' }
);

const Quiz = mongoose.model('Quiz', quizSchema);

const attemptSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    quiz: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz', required: true },
    answers: [
      {
        questionId: mongoose.Schema.Types.ObjectId,
        selectedOptionIndex: Number,
        correct: Boolean,
        pointsEarned: Number,
      },
    ],
    score: Number,
    maxScore: Number,
    startedAt: { type: Date, default: Date.now },
    completedAt: Date,
  },
  { collection: 'attempts' }
);

const Attempt = mongoose.model('Attempt', attemptSchema);

// Quiz routes
app.get('/api/quizzes', async (req, res) => {
  try {
    const quizzes = await Quiz.find().select('-questions.correctOptionIndex');
    res.json(quizzes);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/quizzes', async (req, res) => {
  try {
    const quiz = await Quiz.create(req.body);
    res.status(201).json(quiz);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.get('/api/quizzes/:id', async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id).select('-questions.correctOptionIndex');
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });
    res.json(quiz);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Submit an attempt (score computed server-side)
app.post('/api/attempts', async (req, res) => {
  try {
    const { userId, quizId, answers } = req.body;
    if (!userId || !quizId) return res.status(400).json({ message: 'userId and quizId are required' });

    const quiz = await Quiz.findById(quizId);
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });

    let score = 0;
    let maxScore = 0;
    const answerRecords = [];

    for (let i = 0; i < quiz.questions.length; i++) {
      const q = quiz.questions[i];
      const selected = answers && answers[i] ? answers[i].selectedOptionIndex : null;
      const correct = selected === q.correctOptionIndex;
      const pts = correct ? (q.points || 1) : 0;
      score += pts;
      maxScore += q.points || 1;
      answerRecords.push({ questionId: q._id, selectedOptionIndex: selected, correct, pointsEarned: pts });
    }

    const attempt = await Attempt.create({ user: userId, quiz: quizId, answers: answerRecords, score, maxScore, completedAt: new Date() });
    res.status(201).json(attempt);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/attempts/user/:userId', async (req, res) => {
  try {
    const attempts = await Attempt.find({ user: req.params.userId }).populate('quiz', 'title');
    res.json(attempts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// User performance summary
app.get('/api/users/:id/performance', async (req, res) => {
  try {
    const userId = req.params.id;
    const attempts = await Attempt.find({ user: userId }).populate('quiz', 'title');
    if (!attempts || attempts.length === 0) return res.json({ totalAttempts: 0, averagePercent: 0, bestPercent: 0 });

    const totalAttempts = attempts.length;
    let totalPercent = 0;
    let bestPercent = 0;
    attempts.forEach((a) => {
      const pct = a.maxScore > 0 ? (a.score / a.maxScore) * 100 : 0;
      totalPercent += pct;
      if (pct > bestPercent) bestPercent = pct;
    });
    const averagePercent = totalPercent / totalAttempts;

    res.json({ totalAttempts, averagePercent, bestPercent, attempts });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});


// MongoDB Connection
let memoryMongoServer = null;

async function connectDB() {
  try {
    const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/studentquiz";

    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000,
    });

    console.log(`✅ MongoDB connected successfully at ${mongoUri}`);
  } catch (error) {
    if (process.env.USE_MEMORY_MONGO === "true" || !process.env.MONGO_URI) {
      try {
        memoryMongoServer = await MongoMemoryServer.create();
        const memoryUri = memoryMongoServer.getUri();
        await mongoose.connect(memoryUri, {
          serverSelectionTimeoutMS: 5000,
        });
        console.log(`✅ In-memory MongoDB connected successfully at ${memoryUri}`);
      } catch (memoryError) {
        console.log("⚠️ MongoDB connection failed");
        console.log(memoryError.message);
      }
    } else {
      console.log("⚠️ MongoDB connection failed");
      console.log(error.message);
    }
  }
}

const startServer = (port) => {
  const server = app.listen(port, () => {
    console.log(`🚀 Backend running at http://localhost:${port}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      const nextPort = port + 1;
      console.log(`⚠️ Port ${port} is already in use. Trying ${nextPort}...`);
      server.close(() => startServer(nextPort));
    } else {
      console.error(error);
    }
  });
};

startServer(Number(process.env.PORT || 5001));
connectDB();