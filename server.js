const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
require('dotenv').config();

// Create Express app
const app = express();

// MongoDB setup
// In Azure, we use the app setting
const uri = process.env.MONGODB_URI || process.env.AZURE_APP_SETTING_MONGODB_URI;
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

// Basic middleware
app.use(cors());
app.use(express.json());

// Health check route
app.get('/', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

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
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}).catch(console.error);

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
