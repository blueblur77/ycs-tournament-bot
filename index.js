// index.js
require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const TOURNAMENT_URL = 'https://www.yugioh-card.com/en/events/ygo-championship-series/';
const POSTED_FILE = path.join(__dirname, 'posted.json');

// Load posted IDs (if file missing, start with empty array)
let postedIds = [];
if (fs.existsSync(POSTED_FILE)) {
  try {
    postedIds = JSON.parse(fs.readFileSync(POSTED_FILE, 'utf8'));
  } catch (e) {
    console.error('Failed to parse posted.json, starting fresh:', e);
    postedIds = [];
  }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  // Run immediately on start, then schedule weekly
  checkAndPostTournaments();
  // Every Sunday at 10:00 AM (server local time)
  cron.schedule('0 10 * * 0', () => {
    console.log('Running weekly tournament check...');
    checkAndPostTournaments();
  });
});

async function fetchPage(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  return await response.text();
}

function parseTournaments(html) {
  const $ = cheerio.load(html);
  const tournaments = [];
  // The YGO site uses a list of tournament items – inspect the structure.
  // We'll look for elements with class "event" or similar.
  // This selector may need tweaking if the site changes.
  $('.event-list .event-item').each((i, el) => {
    const name = $(el).find('.event-name').text().trim();
    const date = $(el).find('.event-date').text().trim();
    const location = $(el).find('.event-place').text().trim();
    const link = $(el).find('a').attr('href');
    // Build a deterministic ID – name + date should be unique enough.
    const id = `${name}|${date}`;
    if (name && date) {
      tournaments.push({ id, name, date, location, link });
    }
  });
  return tournaments;
}

async function checkAndPostTournaments() {
  try {
    const html = await fetchPage(TOURNAMENT_URL);
    const tournaments = parseTournaments(html);
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel) {
      console.error('Channel not found');
      return;
    }
    const newTournaments = tournaments.filter(t => !postedIds.includes(t.id));
    for (const t of newTournaments) {
      const embed = new EmbedBuilder()
        .setTitle(t.name)
        .setURL(t.link ? (t.link.startsWith('http') ? t.link : `https://www.yugioh-card.com${t.link}`) : TOURNAMENT_URL)
        .addFields(
          { name: 'Date', value: t.date || 'N/A', inline: true },
          { name: 'Location', value: t.location || 'N/A', inline: true }
        )
        .setColor(0x00b0f4)
        .setTimestamp();
      await channel.send({ embeds: [embed] });
      postedIds.push(t.id);
      console.log(`Posted tournament: ${t.name}`);
    }
    // Save updated posted IDs
    fs.writeFileSync(POSTED_FILE, JSON.stringify(postedIds, null, 2), 'utf8');
  } catch (err) {
    console.error('Error during tournament check:', err);
  }
}

client.login(TOKEN).catch(err => console.error('Login failed:', err));
