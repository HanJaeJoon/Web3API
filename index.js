import express from 'express';
import path from 'path';
import cors from 'cors';
import api from 'api';
import 'dotenv/config';
// eslint-disable-next-line import/extensions
import Moralis from 'moralis/node.js';
import sql from 'mssql';
import nodemailer from 'nodemailer';

const PORT = process.env.PORT || 9090;
// eslint-disable-next-line no-underscore-dangle
const __dirname = path.resolve();

const sqlConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  server: process.env.DB_SERVER,
  port: +process.env.DB_PORT,
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30_000,
  },
  options: {
    encrypt: process.env.DB_OPTIONS_ENCRYPT === 'true', // true for azure
    trustServerCertificate: true, // true for local dev / self-signed certs
  },
};

const app = express();

app
  .set('views', path.join(__dirname, 'views'))
  .use(express.static(path.join(__dirname, 'static')))
  .set('view engine', 'ejs')
  .get('/test', (req, res) => res.render('test'))
  .get('/admin', (req, res) => res.render('admin'))
  .get('/register', (req, res) => res.render('register'))
  .get('/:authKey', async (req, res) => {
    try {
      const pool = await sql.connect(sqlConfig);
      const result = await pool.request()
        .input('authKey', sql.Char, req.params.authKey)
        .query(`
          SELECT * FROM USER_INFO WHERE AuthKey = @authKey
        `);

      return res.render('email', { email: result.recordset[0]?.Email });
    } catch (e) {
      res.status(500).send(`Internal Server Error - ${e.message}`);
    }
  })
  .use(express.json())
  .listen(PORT, () => console.log(`Listening on ${PORT}`));

// testnet
const openseaSdk = api('@opensea/v1.0#7dtmkl3ojw4vb');

app
  .options('/api/fetchAssets/:address', cors())
  .get('/api/fetchAssets/:address', cors(), async (req, res) => {
    try {
      const result = await openseaSdk['retrieving-assets-rinkeby']({
        owner: req.params.address,
        order_direction: 'desc',
        offset: '0',
        limit: '20',
        include_orders: 'false',
      });

      res.json(result);
    } catch (e) {
      res.status(500).send(`Internal Server Error - ${e.message}`);
    }
  });

const validateEmail = (email) => String(email)
  .toLowerCase()
  .match(
    /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
  );

app.post('/api/saveUserAddress', cors(), async (req, res) => {
  try {
    const { body } = req;

    // validation
    if (!body.authKey) {
      res.status(500).send('????????? ???????????????.');
      return;
    }

    if (!validateEmail(body.email)) {
      res.status(500).send('???????????? ?????? email ???????????????.');
      return;
    }

    const pool = await sql.connect(sqlConfig);
    const result1 = await pool.request()
      .input('email', sql.NVarChar, body.email)
      .input('authKey', sql.NVarChar, body.authKey)
      .query(`
        SELECT *
        FROM USER_INFO
        WHERE Email = @email
        AND AuthKey = @authKey
        AND WalletAddress IS NOT NULL
      `);

    if (result1.recordset.length > 0) {
      res.status(500).send('?????? ????????? email?????????.');
      return;
    }

    // insert data
    const result2 = await pool.request()
      .input('email', sql.NVarChar, body.email)
      .input('authKey', sql.NVarChar, body.authKey)
      .input('walletAddress', sql.NVarChar, body.address)
      .query(`
        UPDATE USER_INFO
        SET WalletAddress = @walletAddress
        WHERE Email = @email
        AND AuthKey = @authKey
      `);

    if (result2.rowsAffected[0] === 0) {
      res.status(500).send('????????? ???????????????.');
      return;
    }

    res.sendStatus(200);
  } catch (e) {
    res.status(500).send(`Internal Server Error - ${e.message}`);
  }
});

app.get('/api/fetchUsers', cors(), async (req, res) => {
  try {
    const pool = await sql.connect(sqlConfig);
    const result = await pool.request()
      .query(`
        SELECT * FROM USER_INFO
      `);

    const data = [];

    for (let i = 0; i < result.recordset.length; i += 1) {
      const userInfo = result.recordset[i];
      const address = userInfo.WalletAddress;
      const email = userInfo.Email;
      const isSent = userInfo.IsSent;

      data.push({ address, email, isSent });
    }

    res.json(data);
  } catch (e) {
    res.status(500).send(`Internal Server Error - ${e.message}`);
  }
});

const serverUrl = process.env.MORALIS_APP_URL;
const appId = process.env.MORALIS_APP_ID;
const moralisSecret = process.env.MORALIS_KEY;

app.post('/api/transferNfts', cors(), async (req, res) => {
  try {
    await Moralis.start({
      serverUrl,
      appId,
      masterKey: moralisSecret,
    });

    await Moralis.enableWeb3({
      // rinkeby
      chainId: 0x4,
      privateKey: process.env.NFT_SENDER_PRIVATE_KEY,
      provider: 'network',
      speedyNodeApiKey: process.env.MORALIS_SPEEDY_NODE_API_KEY,
    });

    const {
      type, contractAddress, tokenId, address,
    } = req.body;

    // Moralis ?????? ???????????? private key => address ???????????? ??? ?????????
    // (User??? private key??? ???????????? ???????????? ?????????)
    // ????????? NFT??? ???????????? ?????? private key??? ???????????? ??????????????? ???????????? ??????

    // 1. ????????? ????????? sender address?????? ??????
    if (address.toUpperCase() !== process.env.NFT_SENDER_ADDRESS.toUpperCase()) {
      res.status(401).send('???????????? ?????? ??????????????????.');
      return;
    }

    // 2. ????????? NFT??? ????????? sender address?????? ??????
    /*
    -- Opensea??? lazy minted??? ?????? ?????? minting??? NFT??? ????????? ????????? ?????????
    -- ??????: https://forum.moralis.io/t/nft-minted-on-opensea-does-not-show-up-in-ethnftowners/1769
    const userNfts = await Moralis.Web3API.token.getTokenIdOwners({
      chain: 'rinkeby',
      address: contractAddress,
      token_id: tokenId,
    });

    const data = userNfts.result;

    let hasOwnership = false;

    for (let i = 0; i < data.length; i += 1) {
      const nft = data[i];

      if (nft.owner_of.toUpperCase() === process.env.NFT_SENDER_ADDRESS.toUpperCase()) {
        hasOwnership = true;
        break;
      }
    }

    if (!hasOwnership) {
      res.status(401).send('?????? ??????????????? NFT ???????????? ????????????.');
      return;
    }
    */

    // receiver ??????
    const pool = await sql.connect(sqlConfig);
    const result = await pool.request()
      .query(`
        SELECT * FROM USER_INFO WHERE IsSent = 0
      `);

    if (result.recordset.length === 0) {
      res.status(500).send('?????? ?????????????????????.');
      return;
    }

    // NFT ??????
    let successCount = 0;

    for (let i = 0; i < result.recordset.length; i += 1) {
      const user = result.recordset[i];
      const receiverAddress = user.WalletAddress;

      const option = {
        type: type.toLowerCase(),
        receiver: receiverAddress,
        contractAddress,
        tokenId,
        amount: 1,
      };

      // eslint-disable-next-line no-await-in-loop
      await Moralis.transfer(option);

      // eslint-disable-next-line no-await-in-loop
      const newPool = await sql.connect(sqlConfig);

      // eslint-disable-next-line no-await-in-loop
      await newPool.request()
        .input('walletAddress', sql.NVarChar, receiverAddress)
        .query(`
          UPDATE USER_INFO
          SET IsSent = 1
          WHERE WalletAddress = @walletAddress
        `);

      successCount += 1;
    }

    res.status(200).send(`${successCount} ??? ?????? ??????!`);
  } catch (e) {
    console.log(e);
    res.status(500).send(`Internal Server Error - ${e.message}`);
  }
});

const sendEmail = async (sendEmailOption) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    host: 'smtp.gmail.com',
    // port: 587,
    // secure: false,
    auth: {
      user: process.env.GMAIL_ID,
      pass: process.env.GMAIL_PASSWORD,
    },
  });

  await transporter.sendMail(sendEmailOption);
};

app.post('/api/saveUserAndSendEmail', cors(), async (req, res) => {
  try {
    const { body } = req;

    // validation
    if (!validateEmail(body.email)) {
      res.status(500).send('???????????? ?????? email ???????????????.');
      return;
    }

    const pool = await sql.connect(sqlConfig);
    const result1 = await pool.request()
      .input('email', sql.NVarChar, body.email)
      .query('SELECT * FROM USER_INFO WHERE Email = @email AND WalletAddress IS NOT NULL');

    if (result1.recordset.length > 0) {
      res.status(500).send('?????? ????????? email?????????.');
      return;
    }

    // insert data
    const result2 = await pool.request()
      .input('email', sql.NVarChar, body.email)
      .input('name', sql.NVarChar, body.name)
      .query(`
        INSERT USER_INFO ([Email], [Name])
        VALUES (@email, @name)

        SELECT * FROM USER_INFO WHERE UserInfoIdx = @@IDENTITY
      `);

    // send email
    const link = `https://${req.get('host')}/${result2.recordset[0].AuthKey}`;

    sendEmail({
      from: 'jaejoon.han@crevisse.com',
      to: body.email,
      subject: 'NFT ?????? ??????',
      html: `<a href="${link}">??????</a>`,
    });

    res.sendStatus(200);
  } catch (e) {
    res.status(500).send(`Internal Server Error - ${e.message}`);
  }
});

// from test page
app.post('/api/saveUserData', cors(), async (req, res) => {
  try {
    await Moralis.start({
      serverUrl,
      appId,
      masterKey: moralisSecret,
    });

    const { body } = req;

    const UserAddress = Moralis.Object.extend('UserAddress');
    const userAddress = new UserAddress();

    userAddress.set('address', body.address);
    userAddress.set('email', body.email);

    await userAddress.save();

    res.sendStatus(200);
  } catch (e) {
    res.status(500).send(`Internal Server Error - ${e.message}`);
  }
});

app.post('/api/transferAsset', cors(), async (req, res) => {
  try {
    await Moralis.start({
      serverUrl,
      appId,
      masterKey: moralisSecret,
    });

    await Moralis.enableWeb3({
      // rinkeby
      chainId: 0x4,
      privateKey: process.env.NFT_SENDER_PRIVATE_KEY,
      provider: 'network',
      speedyNodeApiKey: process.env.MORALIS_SPEEDY_NODE_API_KEY,
    });

    const { body } = req;

    const options = {
      type: body.type,
      receiver: body.receiver,
      contractAddress: body.contractAddress,
      tokenId: body.tokenId,
      amount: body.amount,
    };

    try {
      await Moralis.transfer(options);
    } catch (e) {
      console.log(e);
    }

    res.sendStatus(200);
  } catch (e) {
    console.log(e);
    res.status(500).send(`Internal Server Error - ${e.message}`);
  }
});

app.use((req, res) => {
  res.status(404).send(`
    <body style="margin: 0px; background: #0e0e0e; height: 100%">
      <img style="display: block;-webkit-user-select: none;margin: auto;background-color: hsl(0, 0%, 90%);transition: background-color 300ms;" src="https://http.cat/404">
    </body>
  `);
});
