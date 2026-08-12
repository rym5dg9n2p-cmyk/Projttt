const { Client, GatewayIntentBits, EmbedBuilder, Collection } = require('discord.js');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// ============ CONFIGURATION ============
const CONFIG = {
    // Anti-Spam
    SPAM_THRESHOLD: 5,        // messages in 5 seconds
    SPAM_WINDOW: 5000,        // 5 seconds
    MENTION_LIMIT: 5,         // max mentions per message
    TIMEOUT_DURATION: 600000, // 10 minutes (in ms)
    
    // Link Filtering
    BLOCKED_DOMAINS: ['discord.gg', 'discord.com/invite', 'dis.gd', 'discord.io'],
    BLOCK_ALL_URLS: true,     // true = blocks ALL links, false = only BLOCKED_DOMAINS
    
    // Leveling
    XP_PER_MESSAGE: 15,
    XP_COOLDOWN: 60000,       // 60 seconds between XP gains
    LEVEL_UP_CHANNEL: 'announcements', // channel name or ID
};

// ============ DATA STORAGE ============
const userMessages = new Map();    // spam tracking
const userXP = new Map();         // { userId: { xp, level } }
const lastMessageTime = new Map(); // XP cooldown

// ============ ANTI-SPAM SYSTEM ============
function isSpam(userId, message) {
    const now = Date.now();
    const userData = userMessages.get(userId) || [];
    const filtered = userData.filter(t => now - t < CONFIG.SPAM_WINDOW);
    filtered.push(now);
    userMessages.set(userId, filtered);
    
    if (filtered.length >= CONFIG.SPAM_THRESHOLD) {
        return true;
    }
    return false;
}

function countMentions(message) {
    return message.mentions.users.size;
}

// ============ LINK FILTER ============
function containsBlockedLink(content) {
    // Check for any URL if BLOCK_ALL_URLS is true
    if (CONFIG.BLOCK_ALL_URLS) {
        const urlRegex = /https?:\/\/[^\s]+/gi;
        if (urlRegex.test(content)) return true;
    }
    
    // Check specific blocked domains
    const lower = content.toLowerCase();
    for (const domain of CONFIG.BLOCKED_DOMAINS) {
        if (lower.includes(domain)) return true;
    }
    return false;
}

// ============ XP & LEVELING SYSTEM ============
function getXP(userId) {
    if (!userXP.has(userId)) {
        userXP.set(userId, { xp: 0, level: 0 });
    }
    return userXP.get(userId);
}

function calculateLevel(xp) {
    return Math.floor(Math.sqrt(xp / 100));
}

function getXPForNextLevel(level) {
    return 100 * Math.pow(level + 1, 2);
}

async function addXP(userId, message) {
    const now = Date.now();
    const cooldown = lastMessageTime.get(userId) || 0;
    
    if (now - cooldown < CONFIG.XP_COOLDOWN) {
        return; // On cooldown
    }
    
    lastMessageTime.set(userId, now);
    
    const data = getXP(userId);
    data.xp += CONFIG.XP_PER_MESSAGE;
    
    const newLevel = calculateLevel(data.xp);
    const leveledUp = newLevel > data.level;
    
    if (leveledUp) {
        data.level = newLevel;
        await sendLevelUpMessage(message, userId, newLevel);
    }
    
    userXP.set(userId, data);
}

async function sendLevelUpMessage(message, userId, level) {
    const embed = new EmbedBuilder()
        .setTitle('★ LEVELUP!')
        .setDescription(`Congratulations <@${userId}>! You have leveled up to **Level ${level}**!`)
        .setColor(0x00FF00)
        .setFooter({ text: 'NEXCASYSTEM·Nexca' })
        .setTimestamp();
    
    try {
        const channel = message.guild.channels.cache.find(
            c => c.name === CONFIG.LEVEL_UP_CHANNEL || c.id === CONFIG.LEVEL_UP_CHANNEL
        ) || message.channel;
        
        await channel.send({ embeds: [embed] });
    } catch (error) {
        console.error('Failed to send level-up message:', error);
    }
}

// ============ MESSAGE HANDLER ============
client.on('messageCreate', async (message) => {
    // Ignore bots and DMs
    if (message.author.bot || !message.guild) return;
    
    // ===== SPAM CHECK =====
    if (isSpam(message.author.id, message.content)) {
        await message.delete();
        await timeoutUser(message.author.id, message.guild, 'Spamming');
        return sendWarning(message, '🚫 **SPAM DETECTED**', 'You have been timed out for spamming.');
    }
    
    // ===== MENTION CHECK =====
    if (countMentions(message) > CONFIG.MENTION_LIMIT) {
        await message.delete();
        await timeoutUser(message.author.id, message.guild, 'Mass-mentioning');
        return sendWarning(message, '🚫 **MASS MENTIONS**', 'You have been timed out for mass-mentioning members.');
    }
    
    // ===== LINK FILTER CHECK =====
    if (containsBlockedLink(message.content)) {
        await message.delete();
        await timeoutUser(message.author.id, message.guild, 'Suspicious link');
        return sendWarning(
            message, 
            '⛔ **BLACKLISTED WORD TRIGGERED**', 
            `Your message was **deleted** for containing a blacklisted link.\n\n**WORD:** ||${message.content.match(/https?:\/\/[^\s]+/)?.[0] || 'blocked link'}||`,
            'INSANITY EMBEDS'
        );
    }
    
    // ===== XP SYSTEM =====
    await addXP(message.author.id, message);
});

// ============ HELPER FUNCTIONS ============
async function timeoutUser(userId, guild, reason) {
    try {
        const member = await guild.members.fetch(userId);
        if (member) {
            await member.timeout(CONFIG.TIMEOUT_DURATION, `Auto-mod: ${reason}`);
            console.log(`⏰ Timed out ${member.user.tag} for ${reason}`);
        }
    } catch (error) {
        console.error('Failed to timeout user:', error);
    }
}

async function sendWarning(message, title, description, footer = '') {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(0xFF0000)
        .setTimestamp();
    
    if (footer) {
        embed.setFooter({ text: footer });
    }
    
    try {
        await message.channel.send({ content: `<@${message.author.id}>`, embeds: [embed] });
    } catch (error) {
        console.error('Failed to send warning:', error);
    }
}

// ============ COMMANDS ============
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    
    if (interaction.commandName === 'rank') {
        const userId = interaction.options.getUser('user')?.id || interaction.user.id;
        const data = getXP(userId);
        const nextLevelXP = getXPForNextLevel(data.level);
        const embed = new EmbedBuilder()
            .setTitle(`🏆 ${interaction.guild.members.cache.get(userId)?.displayName || 'User'}'s Rank`)
            .addFields(
                { name: 'Level', value: `${data.level}`, inline: true },
                { name: 'XP', value: `${data.xp} / ${nextLevelXP}`, inline: true },
                { name: 'Progress', value: `${Math.floor((data.xp / nextLevelXP) * 100)}%`, inline: true }
            )
            .setColor(0x00FF00);
        await interaction.reply({ embeds: [embed] });
    }
    
    if (interaction.commandName === 'leaderboard') {
        const sorted = Array.from(userXP.entries())
            .sort((a, b) => (b[1].xp || 0) - (a[1].xp || 0))
            .slice(0, 10);
        
        let description = '';
        for (let i = 0; i < sorted.length; i++) {
            const [id, data] = sorted[i];
            const member = await interaction.guild.members.fetch(id).catch(() => null);
            description += `${i + 1}. ${member?.displayName || 'Unknown'} — Level ${data.level} (${data.xp} XP)\n`;
        }
        
        const embed = new EmbedBuilder()
            .setTitle('📊 Top 10 Members')
            .setDescription(description || 'No data yet.')
            .setColor(0x00FF00);
        await interaction.reply({ embeds: [embed] });
    }
});

// ============ REGISTER COMMANDS ============
async function registerCommands() {
    const commands = [
        {
            name: 'rank',
            description: 'Check your or another member\'s rank',
            options: [{
                name: 'user',
                description: 'The user to check',
                type: 6,
                required: false
            }]
        },
        {
            name: 'leaderboard',
            description: 'Show the top 10 members by XP'
        }
    ];
    
    await client.application.commands.set(commands);
    console.log('✅ Commands registered');
}

// ============ START BOT ============
client.on('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    await registerCommands();
});

client.login(process.env.TOKEN);
