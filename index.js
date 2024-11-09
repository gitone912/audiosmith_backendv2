const express = require('express');
const admin = require('firebase-admin');
const bodyParser = require('body-parser');
const serviceAccount = require('./audiosmith-app-firebase-adminsdk-y24ne-aa7752426f.json'); // Secure this path
const cors = require('cors');

// Initialize Firebase Admin SDK
try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
} catch (error) {
  console.error("Failed to initialize Firebase Admin SDK:", error);
  process.exit(1); // Exit if initialization fails
}

const db = admin.firestore();
const app = express();
app.use(cors());
app.use(bodyParser.json());

// Global error handler for uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error("Uncaught Exception:", error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error("Unhandled Rejection:", promise, "reason:", reason);
});

// Endpoint to get/update streak based on user activity
app.post('/updateStreak', async (req, res) => {
  const { email, utcOffsetMinutes } = req.body;

  if (!email || typeof utcOffsetMinutes === 'undefined') {
    return res.status(400).json({ message: 'Email and UTC offset are required' });
  }

  try {
    // Step 1: Find user in the Firestore 'users' collection by email
    const userQuerySnapshot = await db.collection('users').where('email', '==', email).limit(1).get();
    if (userQuerySnapshot.empty) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userDoc = userQuerySnapshot.docs[0];
    const userId = userDoc.id; // This is the user's document ID
    const userData = userDoc.data();
    
    // Step 2: Calculate the current date and time adjusted for the user's UTC offset
    const nowUtc = new Date();
    const localTime = new Date(nowUtc.getTime() + utcOffsetMinutes * 60 * 1000); // Adjust to local time

    // Step 3: Check if 24 hours have passed since last streak update
    const updatedStreakAt = userData.updatedStreakAt?.toDate() || null;
    const twentyFourHours = 24 * 60 * 60 * 1000;

    // Proceed to update streak only if 24 hours have passed since `updatedStreakAt`
    if (!updatedStreakAt || localTime - updatedStreakAt >= twentyFourHours) {

      // Step 4: Query the user's 'chats' and 'chat_monologue' collections for activity within the last 24 hours
      const startTime = new Date(localTime.getTime() - twentyFourHours); // 24 hours ago

      try {
        // Query `chats` collection
        const chatsSnapshot = await db.collection('chats')
          .where('user', '==', email)
          .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(startTime))
          .where('timestamp', '<=', admin.firestore.Timestamp.fromDate(localTime))
          .get();

        // Query `chat_monologue` collection
        const chatMonologueSnapshot = await db.collection('chat_monologue')
          .where('user', '==', email)
          .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(startTime))
          .where('timestamp', '<=', admin.firestore.Timestamp.fromDate(localTime))
          .get();

        // Step 5: Calculate streak change based on activity in either collection
        const totalEntries = chatsSnapshot.size + chatMonologueSnapshot.size;
        let streakChange = totalEntries > 0 ? 1 : -1; // Increase if activity in either collection, else decrease

        // Update the streak, ensuring it doesn't go below zero
        const updatedStreak = Math.max((userData.streak || 0) + streakChange, 0);

        // Step 6: Update the user's streak and `updatedStreakAt` in the users collection
        await db.collection('users').doc(userId).update({
          streak: updatedStreak,
          updatedStreakAt: admin.firestore.Timestamp.fromDate(localTime),
        });

        // Return response
        return res.status(200).json({
          message: `User streak updated successfully.`,
          streakChange,
          streak: updatedStreak,
          totalEntries,
        });
      } catch (error) {
        console.error('Error querying chat data:', error);
        return res.status(500).json({ message: 'Error retrieving user activity.' });
      }
    } else {
      // If 24 hours haven't passed, return a message without updating the streak
      return res.status(200).json({
        message: `Less than 24 hours since last streak update.`,
        streak: userData.streak,
      });
    }
  } catch (error) {
    console.error('Error updating streak:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// Start the server
const PORT = process.env.PORT || 5000;

try {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
} catch (error) {
  console.error("Failed to start the server:", error);
}
