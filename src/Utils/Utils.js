import axios from "axios";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import XMLBuilder from "xmlbuilder";
import User from "../User/Mongodb/Schema/user.js";
import Profile from "../User/Mongodb/Schema/profiles.js";
import Friends from "../User/Mongodb/Schema/friends.js";
import profileManager from "../User/profile.js";
import log from "../Utils/log.js";
import { v4 } from "uuid";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

export default class Utils {
  static createError(
    errorCode,
    errorMessage,
    messageVars,
    numericErrorCode,
    error,
    statusCode,
    res
  ) {
    res.set({
      "X-Epic-Error-Name": errorCode,
      "X-Epic-Error-Code": numericErrorCode,
    });
    res.status(statusCode).json({
      errorCode,
      errorMessage,
      messageVars,
      numericErrorCode,
      originatingService: "any",
      intent: "prod",
      error_description: errorMessage,
      error,
    });
  }

  static async SendEmptyGift(username, accountId, res) {
    try {
      await axios.post(
        `http://127.0.0.1:${process.env.PORT}/fortnite/api/game/v3/profile/*/client/emptygift`,
        {
          offerId: "e406693aa12adbc8b04ba7e6409c8ab3d598e8c3",
          currency: "MtxCurrency",
          currencySubType: "",
          expectedTotalPrice: "0",
          gameContext: "",
          receiverAccountIds: [accountId],
          giftWrapTemplateId: "GiftBox:gb_makegood",
          personalMessage: "Your personal message here",
          accountId,
          playerName: username,
        }
      );
    } catch (err) {
      Utils.createError(
        "errors.com.epicgames.gift.failed",
        "Failed to send empty gift",
        [username],
        16022,
        err.message,
        500,
        res
      );
    }
  }

  static async FetchApplication() {
    const req = await fetch("https://discord.com/api/v10/applications/@me", {
      method: "GET",
      headers: {
        Authorization: `Bot ${process.env.BOT_TOKEN}`,
      },
    });
    const res = await req.json();
    return res;
  }

  static DecodeBase64(str) {
    return Buffer.from(str, "base64").toString();
  }

  static async CreateUser(discordId, username, email, plainPassword, isServer) {
    email = email.toLowerCase();
    if (!discordId || !username || !email || !plainPassword)
      return { message: "Username/email/password is required.", status: 400 };
    if (await User.findOne({ discordId }))
      return { message: "You already created an account!", status: 400 };
    const accountId = v4().replace(/-/gi, "");
    const emailFilter =
      /^([a-zA-Z0-9_\.\-])+\@(([a-zA-Z0-9\-])+\.)+([a-zA-Z0-9]{2,4})+$/;
    if (!emailFilter.test(email))
      return {
        message: "You did not provide a valid email address!",
        status: 400,
      };
    if (username.length >= 25)
      return {
        message: "Your username must be less than 25 characters long.",
        status: 400,
      };
    if (username.length < 3)
      return {
        message: "Your username must be atleast 3 characters long.",
        status: 400,
      };
    if (plainPassword.length >= 128)
      return {
        message: "Your password must be less than 128 characters long.",
        status: 400,
      };
    const allowedCharacters =
      " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~".split(
        ""
      );
    for (let character of username) {
      if (!allowedCharacters.includes(character))
        return {
          message:
            "Your username has special characters, please remove them and try again.",
          status: 400,
        };
    }
    const hashedPassword = await bcrypt.hash(plainPassword, 10);
    const lowercaseEmail = email.toLowerCase();
    try {
      log.debug(
        `Creating account with the username ${username} and email ${lowercaseEmail}`
      );
      await User.create({
        created: new Date().toISOString(),
        banne: false,
        discordId: discordId,
        accountId: v4(),
        username: username,
        username_lower: username.toLowerCase(),
        email: email.toLowerCase(),
        password: hashedPassword,
        isServer: isServer,
        matchmakingId: v4(),
      }).then(async (i) => {
        log.debug(
          `Created user with the username ${username} and email ${lowercaseEmail}`
        );
        await Profile.create({
          created: i.created,
          accountId: i.accountId,
          profiles: await profileManager.createProfiles(
            i.accountId ? i.accountId : ""
          ),
        });
        log.debug(
          `Created profile for the user with the username ${username} and email ${lowercaseEmail}`
        );
        await Friends.create({ created: i.created, accountId: i.accountId });
        log.debug(
          `Created friends for the user with the username ${username} and email ${lowercaseEmail}`
        );
      });
    } catch (err) {
      if (err.code == 11000)
        return { message: `Username or email is already in use.`, status: 400 };
      console.error(err);
      return {
        message: "An unknown error has occured, please try again later.",
        status: 400,
      };
    }
    return {
      message: `Successfully created an account with the username ${username}`,
      status: 200,
    };
  }

  static GetXMPPStatus(fromId, toId, offline) {
    if (!global.Clients) return;
    const SenderData = global.Clients.find((i) => i.accountId == fromId);
    const ClientData = global.Clients.find((i) => i.accountId == toId);
    if (!SenderData || !ClientData) return;

    let xml = XMLBuilder.create("presence")
      .attribute("to", ClientData.jid)
      .attribute("xmlns", "jabber:client")
      .attribute("from", SenderData.jid)
      .attribute("type", offline ? "unavailable" : "available");

    if (SenderData.lastPresenceUpdate.away) {
      xml = xml
        .element("show", "away")
        .up()
        .element("status", SenderData.lastPresenceUpdate.status)
        .up();
    } else {
      xml = xml.element("status", SenderData.lastPresenceUpdate.status).up();
    }

    ClientData.client.send(xml.toString());
  }

  static SendXMPPMessage(body, toAccountId) {
    if (!global.Clients) return;
    if (typeof body === "object") body = JSON.stringify(body);

    const receiver = global.Clients.find((i) => i.accountId == toAccountId);
    if (!receiver) return;

    receiver.client.send(
      XMLBuilder.create("message")
        .attribute("from", "xmpp-admin@prod.ol.epicgames.com")
        .attribute("to", receiver.jid)
        .attribute("xmlns", "jabber:client")
        .element("body", `${body}`)
        .up()
        .toString()
    );
  }

  static GetVersion(req) {
    const memory = { season: 0, build: 0.0, CL: "0", lobby: "" };

    if (req.headers["user-agent"]) {
      let CL = "";
      try {
        let BuildID = req.headers["user-agent"].split("-")[3].split(",")[0];
        if (!Number.isNaN(Number(BuildID))) CL = BuildID;
        else {
          BuildID = req.headers["user-agent"].split("-")[3].split(" ")[0];
          if (!Number.isNaN(Number(BuildID))) CL = BuildID;
        }
      } catch {
        try {
          let BuildID = req.headers["user-agent"].split("-")[1].split("+")[0];
          if (!Number.isNaN(Number(BuildID))) CL = BuildID;
        } catch {}
      }

      try {
        let Build = req.headers["user-agent"]
          .split("Release-")[1]
          .split("-")[0];
        if (Build.split(".").length === 3) {
          const [a, b, c] = Build.split(".");
          Build = `${a}.${b}${c}`;
        }

        memory.season = Number(Build.split(".")[0]);
        memory.build = Number(Build);
        memory.CL = CL;
        memory.lobby = `LobbySeason${memory.season}`;
        if (Number.isNaN(memory.season)) throw new Error();
      } catch {
        if (Number.isNaN(memory.CL)) {
          Object.assign(memory, {
            season: 0,
            build: 0.0,
            CL,
            lobby: "LobbySeason0",
          });
        } else if (Number(memory.CL) < 3724489) {
          Object.assign(memory, {
            season: 0,
            build: 0.0,
            CL,
            lobby: "LobbySeason0",
          });
        } else if (Number(memory.CL) <= 3790078) {
          Object.assign(memory, {
            season: 1,
            build: 1.0,
            CL,
            lobby: "LobbySeason1",
          });
        } else {
          Object.assign(memory, {
            season: 2,
            build: 2.0,
            CL,
            lobby: "LobbyWinterDecor",
          });
        }
      }
    }
    return memory;
  }

  static createClient(clientId, grant_type, ip, expiresIn) {
    const raw = jwt.sign(
      {
        p: Buffer.from(v4()).toString("base64"),
        clsvc: "fortnite",
        t: "s",
        mver: false,
        clid: clientId,
        ic: true,
        am: grant_type,
        jti: v4().replace(/-/gi, ""),
        creation_date: new Date(),
        hours_expire: expiresIn,
      },
      global.JWT_SECRET,
      { expiresIn: `${expiresIn}h` }
    );

    const token = `eg1~${raw}`;
    global.clientTokens.push({ ip, token });
    return token;
  }

  static createAccess(user, clientId, grant_type, deviceId, expiresIn) {
    if (!user || !user.accountId) {
      throw new Error("Invalid user: missing accountId");
    }

    const payload = {
      app: "fortnite",
      sub: user.accountId.toString(),
      dvid: deviceId,
      mver: false,
      clid: clientId,
      dn: user.username || "Unknown",
      am: grant_type,
      p: Buffer.from(v4()).toString("base64"),
      iai: user.accountId,
      sec: 1,
      clsvc: "fortnite",
      t: "s",
      ic: true,
      jti: v4().replace(/-/gi, ""),
      creation_date: new Date().toISOString(),
      hours_expire: expiresIn,
    };

    const raw = jwt.sign(payload, global.JWT_SECRET, {
      expiresIn: `${expiresIn}h`,
    });

    const token = `eg1~${raw}`;
    global.accessTokens.push({
      accountId: user.accountId,
      token,
    });

    return token;
  }

  static createRefresh(user, clientId, grant_type, deviceId, expiresIn) {
    const raw = jwt.sign(
      {
        sub: user.accountId,
        dvid: deviceId,
        t: "r",
        clid: clientId,
        am: grant_type,
        jti: v4().replace(/-/gi, ""),
        creation_date: new Date(),
        hours_expire: expiresIn,
      },
      global.JWT_SECRET,
      { expiresIn: `${expiresIn}h` }
    );

    const token = `eg1~${raw}`;
    global.refreshTokens.push({
      accountId: user.accountId,
      token,
    });
    return token;
  }

  static getOfferID(offerId) {
    const catalog = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../local/Storefront/catalog.json"),
        "utf8"
      )
    );

    for (let storefront of catalog.storefronts) {
      let findOfferId = storefront.catalogEntries.find(
        (i) => i.offerId == offerId
      );
      if (findOfferId)
        return {
          name: storefront.name,
          offerId: findOfferId,
        };
    }

    return catalog;
  }

  static async UpdateTokens() {
    await global.kv.set(
      "tokens",
      JSON.stringify(
        {
          accessTokens: global.accessTokens,
          refreshTokens: global.refreshTokens,
          clientTokens: global.clientTokens,
        },
        null,
        2
      )
    );
  }
}
