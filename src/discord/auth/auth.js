import express from 'express';
import axios from 'axios';
import Utils from '../../Utils/Utils.js';
import session from 'express-session';
import path from 'path';
import log from '../../Utils/log.js';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

mongoose.set('strictQuery', true);

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
    } catch (error) {
        log.discordauth(`MongoDB connection failed: ${error.message}, Stack: ${error.stack}`);
        process.exit(1);
    }
};

connectDB();

const app = express();

app.use(express.json());
app.use(session({
    secret: process.env.CLIENT_SECRET || 'default-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production' }
}));
app.use(express.static(path.join(__dirname, 'Ui')));

const DISCORD_API = 'https://discord.com/api/v10';
const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify%20email`;

app.get('/auth/discord', (req, res) => {
    log.discordauth('Received request to initiate Discord OAuth2 flow');
    log.discordauth(`Redirecting to Discord auth URL: ${discordAuthUrl}`);
    res.redirect(discordAuthUrl);
});

app.get('/auth/discord/callback', async (req, res) => {
    const { code } = req.query;
    log.discordauth(`Received callback with code: ${code || 'No code'}`);

    if (!code) {
        log.discordauth('Error: No authorization code provided in callback');
        return res.status(400).send('No code provided');
    }

    try {
        log.discordauth('Starting token exchange process with code: ' + code);
        const tokenResponse = await axios.post(`${DISCORD_API}/oauth2/token`,
            new URLSearchParams({
                client_id: process.env.CLIENT_ID,
                client_secret: process.env.CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: process.env.REDIRECT_URI,
                scope: 'identify email'
            }), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        log.discordauth('Successfully exchanged code for access token');

        const { access_token } = tokenResponse.data;
        log.discordauth(`Access token retrieved: ${access_token.substring(0, 10)}... (partial for security)`);

        log.discordauth('Fetching user details from Discord API');
        const userResponse = await axios.get(`${DISCORD_API}/users/@me`, {
            headers: {
                Authorization: `Bearer ${access_token}`
            }
        });
        log.discordauth('User details fetched successfully from Discord API');

        const { id: discordId, username, email, avatar, discriminator } = userResponse.data;
        log.discordauth(`User data: DiscordID=${discordId}, Username=${username}, Email=${email}, Avatar=${avatar || 'None'}, Discriminator=${discriminator}`);

        log.discordauth(`Checking if user with DiscordID ${discordId} exists in database`);
        const userCheck = await Utils.CreateUser(
            discordId,
            username,
            email,
            Math.random().toString(36).slice(2),
            false
        );
        log.discordauth(`RegisterUser response: Status=${userCheck.status}, Message=${userCheck.message}`);

        if (userCheck.status !== 200) {
            if (userCheck.message === "You already created an account!") {
                log.discordauth(`User ${username} (DiscordID: ${discordId}) already has an existing account`);
            } else {
                log.discordauth(`Registration failed for user ${username}: ${userCheck.message}`);
                return res.status(userCheck.status).send(userCheck.message);
            }
        } else {
            log.discordauth(`Successfully created new account for user ${username} (DiscordID: ${discordId})`);
        }

        log.discordauth(`Storing session for user: ${username}, DiscordID: ${discordId}`);
        req.session.user = { discordId, username, email, avatar, discriminator };

        log.discordauth(`Redirecting to profile page for user: ${username}`);
        res.redirect('/profile');
    } catch (error) {
        log.discordauth(`Authentication error occurred: ${error.message}, Stack: ${error.stack}`);
        console.error('Detailed auth error:', error);
        res.status(500).send('Authentication failed');
    }
});

app.get('/profile', (req, res) => {
    if (!req.session.user) {
        log.discordauth('No active session detected, redirecting to Discord auth');
        return res.redirect('/auth/discord');
    }

    log.discordauth(`Serving profile page for user: ${req.session.user.username}, DiscordID: ${req.session.user.discordId}`);
    res.sendFile(path.join(__dirname, 'Ui', 'Ui.html'));
});

app.get('/api/user', (req, res) => {
    if (!req.session.user) {
        log.discordauth('Unauthorized /api/user request: No session found');
        return res.status(401).json({ error: 'Unauthorized' });
    }
    log.discordauth(`Serving user data for: ${req.session.user.username}, Data: ${JSON.stringify(req.session.user)}`);
    res.json(req.session.user);
});

app.listen(99, () => log.discordauth('Server started and listening on port 99'));