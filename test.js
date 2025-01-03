import fetch from 'node-fetch';

const testFeedback = async () => {
  try {
    // Test health endpoint
    const healthCheck = await fetch('http://localhost:3000/');
    console.log('Health check response:', await healthCheck.json());

    // Test feedback submission
    const feedbackResponse = await fetch('http://localhost:3000/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        userMessage: "How do I reset my password?",
        botResponse: "You can reset your password by clicking the Forgot Password link on the login page.",
        feedback: "The response was helpful",
        rating: 5,
        userId: "user123",
        userName: "John Doe"
      })
    });
    
    console.log('Feedback submission response:', await feedbackResponse.json());
  } catch (error) {
    console.error('Error:', error);
  }
};

testFeedback();
