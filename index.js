// server.js – revised & hardened Socket.IO backend
// Author: ChatGPT – April 2025
// -----------------------------------------------------------
// Key upgrades 🎯
// 1. Multi‑device support (many sockets per user)
// 2. Emits **populated** sender object so avatars/ names show instantly
// 3. Ack‑friendly API with proper error surfaces
// 4. Helper utilities for cleaner code & less duplication
// 5. Improved CORS (comma‑separated list of origins)
// 6. Minor Mongo/Express niceties & stricter error handling
// -----------------------------------------------------------

require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const mongoose = require("mongoose");

// --- models ------------------------------------------------
const User = require("./models/User");
const Conversation = require("./models/Conversation");
const Message = require("./models/Message");

// --- express + cors ---------------------------------------
const app = express();
app.use(
    cors({
        origin: (process.env.CLIENT_URL || "http://localhost:3000").split(","),
        credentials: true,
    })
);
app.use(express.json());

// --- server + socket.io -----------------------------------
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: (process.env.CLIENT_URL || "http://localhost:3000").split(","),
        methods: ["GET", "POST"],
        credentials: true,
    },
});

// --- database --------------------------------------------
mongoose
    .connect(process.env.MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    })
    .then(() => console.log("✅  MongoDB connected"))
    .catch((err) => console.error("❌  MongoDB connection error:", err));

// --- utility helpers --------------------------------------
const userSockets = new Map(); // userId → Set(socketId)

function addSocket(userId, socketId) {
    if (!userSockets.has(userId)) userSockets.set(userId, new Set());
    userSockets.get(userId).add(socketId);
}

function removeSocket(userId, socketId) {
    const set = userSockets.get(userId);
    if (!set) return;
    set.delete(socketId);
    if (set.size === 0) userSockets.delete(userId);
}

function emitToUser(userId, event, payload) {
    const sockets = userSockets.get(userId);
    if (!sockets) return;
    sockets.forEach((sid) => io.to(sid).emit(event, payload));
}

function pickUserFields(user) {
    return {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        profilePicture: user.profilePicture,
        status: user.status,
    };
}

// --- socket handlers --------------------------------------
io.on("connection", (socket) => {
    console.log("🔌  socket connected:", socket.id);

    // user joins the network (after auth handshake on client)
    socket.on("join", async (userId) => {
        if (!userId) return;
        try {
            addSocket(userId, socket.id);
            socket.join(userId); // personal room for direct emits

            await User.findByIdAndUpdate(userId, { status: "online" });
            socket.broadcast.emit("user-status-change", { userId, status: "online" });
        } catch (err) {
            console.error("join error", err);
        }
    });

    // send‑message: now with ack + populated sender
    socket.on("send-message", async (data, ack) => {
        try {
            const { senderId, receiverId, content, conversationId, messageId } = data;
            if (!senderId || !receiverId || !content)
                throw new Error("Incomplete message payload");

            // fetch sender details for avatar/name (lightweight select)
            const senderDoc = await User.findById(senderId).select(
                "firstName lastName profilePicture status"
            );
            if (!senderDoc) throw new Error("Sender not found");

            const payload = {
                _id: messageId,
                senderId: pickUserFields(senderDoc),
                receiverId,
                content,
                conversationId,
                createdAt: new Date().toISOString(),
                read: false,
            };

            // real‑time emit to both participants (handles multi‑tab)
            emitToUser(receiverId, "receive-message", payload);
            emitToUser(senderId, "receive-message", payload);

            ack?.({ ok: true });
        } catch (err) {
            console.error("send-message error", err);
            ack?.({ ok: false, error: err.message });
        }
    });

    // typing indicator
    socket.on("typing", ({ senderId, receiverId, isTyping }) => {
        emitToUser(receiverId, "user-typing", { userId: senderId, isTyping });
    });

    // mark messages as read
    socket.on("mark-read", async ({ senderId, conversationId }) => {
        try {
            await Message.updateMany(
                { conversationId, receiverId: senderId, read: false },
                { $set: { read: true } }
            );

            const convo = await Conversation.findById(conversationId);
            if (convo) {
                convo.unreadCount[senderId] = 0;
                await convo.save();

                convo.participants.forEach((p) => {
                    const pid = p.toString();
                    if (pid !== senderId) {
                        emitToUser(pid, "messages-read", { conversationId, readerId: senderId });
                    }
                });
            }
        } catch (err) {
            console.error("mark-read error", err);
        }
    });

    // graceful disconnect
    socket.on("disconnect", async () => {
        console.log("⚡  socket disconnected:", socket.id);

        let uidFound = null;
        for (const [uid, set] of userSockets.entries()) {
            if (set.has(socket.id)) {
                uidFound = uid;
                removeSocket(uid, socket.id);
                break;
            }
        }

        // if no more sockets for that user -> offline broadcast
        if (uidFound && !userSockets.has(uidFound)) {
            try {
                await User.findByIdAndUpdate(uidFound, { status: "offline" });
                socket.broadcast.emit("user-status-change", { userId: uidFound, status: "offline" });
            } catch (err) {
                console.error("disconnect error", err);
            }
        }
    });
});

// --- misc routes ------------------------------------------
app.get("/health", (_, res) => res.status(200).json({ status: "ok" }));

// --- start -------------------------------------------------
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`🚀  Socket.IO server running on :${PORT}`));
