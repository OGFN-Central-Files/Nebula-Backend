import { SlashCommandBuilder } from 'discord.js';
import Profile from '../../../User/Mongodb/Schema/profiles.js';
import User from '../../../User/Mongodb/Schema/user.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { dirname } from 'dirname-filename-esm';
import destr from 'destr';
import axios from 'axios';
import log from "../../../Utils/log.js";

import dotenv from "dotenv";
dotenv.config();

const __dirname = dirname(import.meta);
const REQUIRED_ROLE_ID = '1332158685333422121';
const WEBHOOK_URL = process.env.LOG_WEBHOOK;

async function sendWebhookLog(discordUser, action, status, details = {}) {
  const webhookEmbed = {
    embeds: [
      {
        title: "Booster Rewards Claim",
        description: `A user attempted to claim Booster Rewards: ${status}`,
        color: status === 'Success' ? 0x9370db : 0xff0000,
        fields: [
          {
            name: "Action",
            value: action,
            inline: true,
          },
          {
            name: "Discord ID",
            value: discordUser.id,
            inline: true,
          },
          {
            name: "Username",
            value: discordUser.username || 'Unknown',
            inline: true,
          },
          ...(Object.keys(details).map(key => ({
            name: key,
            value: details[key],
            inline: true,
          }))),
        ],
        thumbnail: {
          url: discordUser.displayAvatarURL({ dynamic: true }),
        },
        timestamp: new Date().toISOString(),
        footer: {
          text: 'Reward System',
          icon_url:
            "https://cdn.discordapp.com/app-assets/432980957394370572/1084188429077725287.png",
        },
      },
    ],
  };

  try {
    await axios.post(WEBHOOK_URL, webhookEmbed);
    log.backend(`Successfully sent webhook for ${action} (${status})`);
  } catch (error) {
    log.error(`Failed to send webhook for ${action}: ${error.message}`);
  }
}

export const data = new SlashCommandBuilder()
  .setName('claim-booster-rewards')
  .setDescription('Claim The Booster Rewards')
  .setDMPermission(false);

export const execute = async (interaction) => {
  await interaction.deferReply({ ephemeral: true });

  if (!interaction.member.roles.cache.has(REQUIRED_ROLE_ID)) {
    await sendWebhookLog(interaction.user, 'Claim Attempt', 'Failed', { Reason: 'Missing required role' });
    return interaction.editReply({ content: 'You do not have the required role to use this command.' });
  }

  const discordId = interaction.user.id;

  try {
    const user = await User.findOne({ discordId });
    if (!user) {
      await sendWebhookLog(interaction.user, 'Claim Attempt', 'Failed', { Reason: 'User profile not found' });
      return interaction.editReply({ content: 'Your user profile is not found in the database.' });
    }

    const accountId = user.accountId;
    const profile = await Profile.findOne({ accountId });
    if (!profile) {
      await sendWebhookLog(interaction.user, 'Claim Attempt', 'Failed', { Reason: 'Profile data not found' });
      return interaction.editReply({ content: 'Your profile data is not found.' });
    }

    const commonCoreProfile = profile.profiles.common_core;
    const athenaProfile = profile.profiles.athena;

    const cosmeticIds = [
      'CID_089_Athena_Commando_M_RetroGrey',
      'CID_085_Athena_Commando_M_Twitch',
      'CID_114_Athena_Commando_F_TacticalWoodland',
      'EID_HipHop01',
      'Pickaxe_ID_044_TacticalUrbanHammer',
      'Glider_ID_018_Twitch',
      'BID_049_TacticalWoodland'
    ];

    const file = fs.readFileSync(
      path.join(__dirname, '../../../../Config/FL/allathena.json')
    );
    const jsonFile = destr(file.toString());
    const items = jsonFile.items;

    const updates = {};
    for (const cosmeticId of cosmeticIds) {
      const key = cosmeticId.startsWith('CID_') ? `AthenaCharacter:${cosmeticId}` :
        cosmeticId.startsWith('EID_') ? `AthenaDance:${cosmeticId}` :
          cosmeticId.startsWith('Pickaxe_') ? `AthenaPickaxe:${cosmeticId}` :
            cosmeticId.startsWith('Glider_') ? `AthenaGlider:${cosmeticId}` :
              cosmeticId.startsWith('BID_') ? `AthenaBackpack:${cosmeticId}` : cosmeticId;

      if (!items[key]) {
        log.backend(`Cosmetic ${key} not found in allathena.json for user ${discordId}`);
        continue;
      }

      if (athenaProfile.items[key]) {
        log.backend(`User ${discordId} already has cosmetic ${key}`);
        continue;
      }

      updates[`profiles.athena.items.${key}`] = items[key];
    }

    if (Object.keys(updates).length > 0) {
      await Profile.findOneAndUpdate(
        { accountId },
        { $set: updates },
        { new: true }
      );
    }

    if (!commonCoreProfile.items.stats) {
      commonCoreProfile.items.stats = {};
    }
    if (!commonCoreProfile.items.stats.attributes) {
      commonCoreProfile.items.stats.attributes = {};
    }
    commonCoreProfile.items.stats.attributes.BoosterRewards = true;

    const giftBoxId = uuidv4();
    commonCoreProfile.items[giftBoxId] = {
      templateId: 'GiftBox:GB_Twitch',
      attributes: {
        fromAccountId: '[Epic Games]',
        params: {
          DefaultHeaderText: 'Twitch Prime Pack!',
          DefaultBodyText: 'Thanks for linking your Twitch Prime!',
          userMessage: 'Enjoy Your Booster Rewards!'
        },
        lootList: cosmeticIds.map(id => {
          const itemType = id.startsWith('CID_') ? `AthenaCharacter:${id}` :
            id.startsWith('EID_') ? `AthenaDance:${id}` :
              id.startsWith('Pickaxe_') ? `AthenaPickaxe:${id}` :
                id.startsWith('Glider_') ? `AthenaGlider:${id}` :
                  id.startsWith('BID_') ? `AthenaBackpack:${id}` : id;
          return {
            itemType,
            itemGuid: itemType,
            quantity: 1
          };
        }),
        giftedOn: new Date().toISOString()
      },
      quantity: 1
    };

    commonCoreProfile.rvn += 1;
    commonCoreProfile.commandRevision += 1;

    await Profile.updateOne(
      { accountId },
      { $set: { 'profiles.common_core': commonCoreProfile } }
    );

    await sendWebhookLog(interaction.user, 'Claim Booster Rewards', 'Success', { CosmeticsClaimed: cosmeticIds.length.toString() });
    await interaction.editReply({
      content: `You have successfully claimed the Booster Rewards!`
    });

  } catch (error) {
    await sendWebhookLog(interaction.user, 'Claim Attempt', 'Failed', { Reason: error.message });
    log.error(`Error claiming Booster Rewards for user ${discordId}: ${error.message}`);
    await interaction.editReply({ content: 'An error occurred while claiming the Booster Rewards.' });
  }
};