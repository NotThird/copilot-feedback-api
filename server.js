require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

// Enhanced error handling for uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Create Express app
const app = express();

// Log detailed startup information
console.log('=== Starting Feedback API ===');
console.log('Environment Variables:');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT:', process.env.PORT);
console.log('MONGO_URI:', process.env.MONGO_URI ? '[SET]' : '[NOT SET]');
console.log('COSMOS_DB_NAME:', process.env.COSMOS_DB_NAME);
console.log('COSMOS_CONTAINER_NAME:', process.env.COSMOS_CONTAINER_NAME);
console.log('\nSystem Information:');
console.log('Node Version:', process.version);
console.log('Current Directory:', process.cwd());
console.log('Process ID:', process.pid);
console.log('Memory Usage:', JSON.stringify(process.memoryUsage()));
console.log('Platform:', process.platform);
console.log('Architecture:', process.arch);
console.log('=========================');

// Additional logging for deployment
console.log('Deployment Details:');
console.log('AZURE_WEBAPP_NAME:', process.env.AZURE_WEBAPP_NAME);
console.log('AZURE_WEBAPP_PACKAGE_PATH:', process.env.AZURE_WEBAPP_PACKAGE_PATH);
console.log('=========================');

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

// Health check route with version and DB status
app.get('/', (req, res) => {
  const dbStatus = mongoose.connection.readyState;
  const dbStatusMap = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };

  res.json({
    status: 'healthy',
    version: process.env.API_VERSION || 'v1',
    environment: NODE_ENV,
    database: {
      status: dbStatusMap[dbStatus] || 'unknown',
      name: process.env.COSMOS_DB_NAME
    },
    timestamp: new Date().toISOString()
  });
});

// POST route to receive feedback
app.post('/feedback', async (req, res) => {
  // Check if MongoDB is connected
  if (!mongoose.connection.readyState) {
    return res.status(503).json({
      message: 'Database connection unavailable',
      error: 'The service is temporarily unable to handle the request due to database connectivity issues'
    });
  }

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

// Azure Web App specific configurations
const PORT = process.env.PORT || process.env.WEBSITE_PORT || 8080;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Feedback API listening on port ${PORT} in ${NODE_ENV} mode`);
  console.log(`Application running at: http://0.0.0.0:${PORT}`);

  // MongoDB Connection after server starts
  const { MONGO_URI, COSMOS_DB_NAME } = process.env;
  
  if (MONGO_URI && COSMOS_DB_NAME) {
    mongoose
      .connect(MONGO_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        dbName: COSMOS_DB_NAME,
        retryWrites: false,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      })
      .then(() => console.log(`Connected to MongoDB (Azure Cosmos DB) - Database: ${COSMOS_DB_NAME}`))
      .catch((err) => {
        console.error('MongoDB connection error:', err);
        // Don't exit process, let the API continue running
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
  } else {
    console.warn('MongoDB connection details missing. Running without database connection.');
  }
});

// Enhanced error handling for Azure
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    message: 'Internal server error',
    error: NODE_ENV === 'development' ? err.message : undefined,
    requestId: req.headers['x-ms-request-id'] || undefined
  });
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
