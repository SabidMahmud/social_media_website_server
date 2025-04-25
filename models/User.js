// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    firstName: {
        type: String,
        required: true,
    },
    lastName: {
        type: String,
        required: true,
    },
    email: {
        type: String,
        required: true,
        unique: true,
    },
    password: {
        type: String,
        required: true,
    },
    profilePicture: {
        type: String,
    },
    status: {
        type: String,
        enum: ['online', 'offline'],
        default: 'offline',
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

module.exports = mongoose.models.User || mongoose.model('User', userSchema);


