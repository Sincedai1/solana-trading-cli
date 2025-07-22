import { Connection, PublicKey } from "@solana/web3.js";
import fs from "fs";
import { buy, sell } from "../src/jupiter/swap";
import { connection as defaultConnection, wallet } from "../src/helpers/config";
import { getSPLTokenBalance } from "../src/helpers/check_balance";

export interface BasicBotConfig {
  rpcEndpoint?: string;
  slippage?: number;
  tradeAmount?: number;
  /**
   * Percentage increase from the previous price that triggers a buy.
   * Example: 0.02 = 2% increase.
   */
  buyThreshold?: number;
  /**
   * Percentage drop from the last buy price that triggers a sell.
   * Example: -0.02 = 2% decrease.
   */
  sellThreshold?: number;
}

export class BasicTradingBot {
  connection: Connection;
  slippage: number;
  tradeAmount: number;
  buyThreshold: number;
  sellThreshold: number;
  private lastPrice?: number;
  private holding = false;

  constructor(config: BasicBotConfig = {}) {
    this.connection = config.rpcEndpoint
      ? new Connection(config.rpcEndpoint)
      : defaultConnection;
    this.slippage = config.slippage ?? 100;
    this.tradeAmount = config.tradeAmount ?? 0.1;
    this.buyThreshold = config.buyThreshold ?? 0.02;
    this.sellThreshold = config.sellThreshold ?? -0.02;
  }

  async monitorToken(tokenAddress: string) {
    console.log(`Monitoring token: ${tokenAddress}`);
    setInterval(async () => {
      try {
        const price = await this.getTokenPrice(tokenAddress);
        await this.evaluateTradeOpportunity(tokenAddress, price);
      } catch (err) {
        console.error("Monitoring error:", err);
      }
    }, 5000);
  }

  async getTokenPrice(tokenAddress: string): Promise<number> {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
    const response = await fetch(url);
    const data = await response.json();
    return data.pairs?.[0]?.priceUsd ?? 0;
  }

  async evaluateTradeOpportunity(token: string, price: number) {
    if (this.lastPrice === undefined) {
      this.lastPrice = price;
      console.log(`Starting price: $${price}`);
      return;
    }
    if (this.shouldBuy(price)) {
      await this.executeBuy(token);
    } else if (this.shouldSell(price)) {
      await this.executeSell(token);
    }
    this.lastPrice = price;
  }

  shouldBuy(currentPrice: number): boolean {
    if (this.holding) return false;
    if (this.lastPrice === undefined) return false;
    const change = (currentPrice - this.lastPrice) / this.lastPrice;
    return change >= this.buyThreshold;
  }

  shouldSell(currentPrice: number): boolean {
    if (!this.holding || this.lastPrice === undefined) return false;
    const change = (currentPrice - this.lastPrice) / this.lastPrice;
    return change <= this.sellThreshold;
  }

  async executeBuy(token: string) {
    console.log(`Buying ${token}`);
    await buy(token, this.tradeAmount, this.slippage);
    this.holding = true;
  }

  async executeSell(token: string) {
    console.log(`Selling ${token}`);
    const balance = await getSPLTokenBalance(
      this.connection,
      new PublicKey(token),
      wallet.publicKey
    );
    await sell(token, balance, this.slippage);
    this.holding = false;
  }
}

if (require.main === module) {
  const token = process.argv[2];
  const configPath = process.argv[3];
  if (!token) {
    console.error(
      "Usage: ts-node examples/basic-bot.ts <TOKEN_ADDRESS> [CONFIG_PATH]"
    );
    process.exit(1);
  }

  let config: BasicBotConfig = {};
  if (configPath) {
    try {
      const raw = fs.readFileSync(configPath, "utf8");
      config = JSON.parse(raw);
    } catch (e) {
      console.error(`Failed to load config from ${configPath}:`, e);
    }
  }

  const bot = new BasicTradingBot(config);
  bot.monitorToken(token);
}
