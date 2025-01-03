#!/bin/bash
echo "Starting Feedback API..."
echo "Node Version: $(node --version)"
echo "NPM Version: $(npm --version)"
echo "Current Directory: $(pwd)"
echo "Files in Directory:"
ls -la

# Start the application
node index.js
