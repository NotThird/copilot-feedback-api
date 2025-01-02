require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

// Create Express app
const app = express();

// Environment variables
const {
  NODE_ENV = 'development',
  CORS_ORIGIN = '*',
  BODY_LIMIT = '10mb',
  ENABLE_REQUEST_LOGGING = 'true',
  ENABLE_RATE_LIMITING = 'true',
  RATE_LIMIT_WINDOW_MS = '900000',
  RATE_LIMIT_MAX_REQUESTS = '100',
  LOG_LEVEL = 'info'
} = process.env;

// Middleware
app.use(cors({
  origin: CORS_ORIGIN.split(',').map(origin => origin.trim()),
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json({ limit: BODY_LIMIT }));

// Request logging middleware
if (ENABLE_REQUEST_LOGGING === 'true') {
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  });
}

// Rate limiting middleware
if (ENABLE_RATE_LIMITING === 'true') {
  const rateLimit = require('express-rate-limit');
  app.use(rateLimit({
    windowMs: parseInt(RATE_LIMIT_WINDOW_MS),
    max: parseInt(RATE_LIMIT_MAX_REQUESTS)
  }));
}

// Feedback schema with validation
const feedbackSchema = new mongoose.Schema({
  userMessage: {
    type: String,
    required: [true, 'User message is required'],
    trim: true
  },
  botResponse: {
    type: String,
    required: [true, 'Bot response is required'],
    trim: true
  },
  feedback: {
    type: String,
    required: [true, 'Feedback is required'],
    trim: true
  },
  rating: {
    type: Number,
    required: [true, 'Rating is required'],
    min: [1, 'Rating must be between 1 and 5'],
    max: [5, 'Rating must be between 1 and 5']
  },
  userId: {
    type: String,
    required: [true, 'User ID is required'],
    trim: true,
    index: true
  },
  userName: {
    type: String,
    required: [true, 'User name is required'],
    trim: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true,
  collection: process.env.COSMOS_CONTAINER_NAME
});

// Add compound index for userId and createdAt
feedbackSchema.index({ userId: 1, createdAt: -1 });

const Feedback = mongoose.model('Feedback', feedbackSchema);

// MongoDB Connection
const {
  MONGO_URI,
  COSMOS_DB_NAME
} = process.env;

mongoose
  .connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    dbName: COSMOS_DB_NAME,
    retryWrites: false, // Cosmos DB requirement
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  })
  .then(() => console.log(`Connected to MongoDB (Azure Cosmos DB) - Database: ${COSMOS_DB_NAME}`))
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Handle MongoDB connection events
mongoose.connection.on('error', err => {
  console.error('MongoDB error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB disconnected. Attempting to reconnect...');
});

mongoose.connection.on('reconnected', () => {
  console.log('MongoDB reconnected');
});

// Health check route
app.get('/', (req, res) => {
  res.json({
    status: 'healthy',
    version: process.env.API_VERSION || 'v1',
    environment: NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

// POST route to receive feedback
app.post('/feedback', async (req, res) => {
  try {
    const { userMessage, botResponse, feedback, rating, userId, userName } = req.body;

    // Create new feedback
    const newFeedback = new Feedback({
      userMessage,
      botResponse,
      feedback,
      rating: parseInt(rating), // Convert to number in case it's sent as string
      userId,
      userName
    });

    // Validate the document
    const validationError = newFeedback.validateSync();
    if (validationError) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: Object.values(validationError.errors).map(err => err.message)
      });
    }

    // Save feedback
    await newFeedback.save();

    // Log success if enabled
    if (LOG_LEVEL === 'debug') {
      console.log(`Feedback saved successfully: ${newFeedback._id}`);
    }

    res.status(201).json({
      message: 'Feedback saved successfully',
      data: newFeedback
    });
  } catch (error) {
    console.error('Error saving feedback:', error);
    
    // Handle different types of errors
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        message: 'Validation failed',
        errors: Object.values(error.errors).map(err => err.message)
      });
    }

    res.status(500).json({
      message: 'Error saving feedback',
      error: NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Feedback API listening on port ${PORT} in ${NODE_ENV} mode`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received. Closing HTTP server and database connection...');
  server.close(() => {
    mongoose.connection.close(false, () => {
      console.log('Server and database connection closed.');
      process.exit(0);
    });
  });
});
