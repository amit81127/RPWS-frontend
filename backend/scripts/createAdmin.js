require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/userModel");

async function createAdmin() {
  const email = process.argv[2] || process.env.ADMIN_EMAIL;
  const password = process.argv[3] || process.env.ADMIN_PASSWORD;
  const name = process.argv[4] || "Administrator";

  if (!email || !password) {
    console.error("Usage: node scripts/createAdmin.js <email> <password> [name]");
    console.error("Or set ADMIN_EMAIL and ADMIN_PASSWORD environment variables.");
    process.exit(1);
  }

  const mongoUrl = process.env.MONGO_URL || "mongodb://127.0.0.1:27017/ratingdb";
  await mongoose.connect(mongoUrl);

  const normalizedEmail = email.toLowerCase().trim();
  const existing = await User.findOne({ email: normalizedEmail });

  if (existing) {
    existing.role = "admin";
    existing.password = password; // pre-save hook will hash it cleanly
    await existing.save();
    console.log(`✅ Existing user [${normalizedEmail}] promoted to admin.`);
  } else {
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password,
      role: "admin",
    });
    console.log(`✅ New admin created: [${user.email}]`);
  }

  await mongoose.connection.close();
  process.exit(0);
}

createAdmin().catch((err) => {
  console.error("❌ Failed to provision admin:", err.message);
  process.exit(1);
});
