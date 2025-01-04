const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
require('dotenv').config();

// Create Express app
const app = express();

// Log startup information
console.log('Starting server...');
console.log('Node.js Version:', process.version);
console.log('Environment:', process.env.NODE_ENV);
console.log('Azure Website Name:', process.env.WEBSITE_SITE_NAME || 'Not running in Azure');

// Basic middleware
app.use(cors());
app.use(express.json());

// Add error handling middleware early
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    message: 'Internal server error',
    error: err.message
  });
});

// MongoDB setup
// In Azure, we use the app setting
const uri = process.env.MONGODB_URI || process.env.AZURE_APP_SETTING_MONGODB_URI;
if (!uri) {
    console.error('MongoDB URI is not set. Please check environment variables.');
    if (process.env.WEBSITE_SITE_NAME) {
        console.error('Running in Azure - check Application Settings for MONGODB_URI');
    }
}

// Add basic health check early
app.get('/', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
    mongodb: uri ? 'configured' : 'not configured'
  });
});
const client = new MongoClient(uri);
let db;
let feedbackCollection;

async function connectToMongo() {
  try {
    console.log('Attempting to connect to MongoDB...');
    console.log('Using URI:', uri ? 'URI is set' : 'URI is not set');
    await client.connect();
    console.log('Connected to MongoDB successfully');
    db = client.db('feedback');
    feedbackCollection = db.collection('feedback-data');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    console.error('Full error details:', JSON.stringify(error, null, 2));
    // Don't exit process in Azure
    if (process.env.WEBSITE_SITE_NAME) {
      console.log('Running in Azure, keeping process alive despite error');
    } else {
      process.exit(1);
    }
  }
}


// POST route to receive feedback
app.post('/feedback', async (req, res) => {
  try {
    const { userMessage, botResponse, feedback, rating, userId, userName } = req.body;
    
    // Basic validation
    if (!userMessage || !botResponse || !feedback || !rating || !userId || !userName) {
      return res.status(400).json({
        message: 'Missing required fields',
        required: ['userMessage', 'botResponse', 'feedback', 'rating', 'userId', 'userName']
      });
    }

    // Create new feedback entry
    const newFeedback = {
      userMessage,
      botResponse,
      feedback,
      rating: parseInt(rating),
      userId,
      userName,
      createdAt: new Date().toISOString(),
      id: Date.now().toString()
    };

    // Store feedback in MongoDB
    await feedbackCollection.insertOne(newFeedback);

    res.status(201).json({
      message: 'Feedback saved successfully',
      data: newFeedback
    });
  } catch (error) {
    console.error('Error saving feedback:', error);
    res.status(500).json({
      message: 'Error saving feedback',
      error: error.message
    });
  }
});

// Get all feedback
app.get('/feedback', async (req, res) => {
  try {
    const feedback = await feedbackCollection.find({}).toArray();
    res.json(feedback);
  } catch (error) {
    console.error('Error retrieving feedback:', error);
    res.status(500).json({
      message: 'Error retrieving feedback',
      error: error.message
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    message: 'Internal server error',
    error: err.message
  });
});

// Azure Web Apps will set process.env.PORT
const port = process.env.PORT || 3000;

// Connect to MongoDB then start server
connectToMongo().then(() => {
  const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log('Server is ready to accept connections');
  });

  // Handle server errors
  server.on('error', (error) => {
    console.error('Server error:', error);
    if (error.code === 'EADDRINUSE') {
      console.log('Address in use, retrying...');
      setTimeout(() => {
        server.close();
        server.listen(port);
      }, 1000);
    }
  });
}).catch(error => {
  console.error('Failed to start server:', error);
  if (!process.env.WEBSITE_SITE_NAME) {
    process.exit(1);
  }
});

// Handle process termination
process.on('SIGINT', async () => {
  try {
    await client.close();
    console.log('MongoDB connection closed');
    process.exit(0);
  } catch (error) {
    console.error('Error closing MongoDB connection:', error);
    process.exit(1);
  }
});
