import {BigDecimal, Address, BigInt} from '@graphprotocol/graph-ts/index'
import {BIG_DECIMAL_ZERO, BIG_DECIMAL_ONE, ADDRESS_ZERO} from 'const'

import {Pair, Token} from '../generated/schema'
import {factoryContract} from './helpers'
import {getBundle} from './mappings'

const WFTM_ADDRESS = '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7'
const USDC_WFTM_PAIR = '0xC94B4961478132cC14e49C7c2C00771066aF3870' // created at 30523830

// TODO add more stablepairs á la:
// https://github.com/Uniswap/v2-subgraph/blob/537e5392719ea9b02b3e56a42c1f3eba116d6918/src/mappings/pricing.ts#L11
export function getFtmPriceInUSD(): BigDecimal {
  let usdcPair = Pair.load(USDC_WFTM_PAIR) // usdc is token0

  if (usdcPair !== null) {
    return usdcPair.token0Price
  } else {
    return BIG_DECIMAL_ZERO
  }
}

// token where amounts should contribute to tracked volume and liquidity
let WHITELIST: string[] = [
  // main
  '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', // WFTM
  '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', // USDC
  '0xd586e7f844cea2f87f50152665bcbc2c279d8d70', // DAI

  // misc, alphabetical
  '0xd24c2ad096400b6fbcd2ad8b24e7acbc21a1da64', // FRAX
  '0x99d8a9c45b2eca8864373a26d1459e3dff1e17f3', // MIM
  '0xdbf31df14b66535af65aac99c32e9ea844e14501', // renBTC
  '0x50b7545627a5162f82a992c33b87adc75187b218', // WBTC
]

// minimum liquidity required to count towards tracked volume for pairs with small # of LP's
let MINIMUM_USD_THRESHOLD_NEW_PAIRS = BigDecimal.fromString('1')

// minimum liquidity for price to get tracked
let MINIMUM_LIQUIDITY_THRESHOLD_FTM = BigDecimal.fromString('1')

export function findFtmPerToken(token: Token, stable: boolean): BigDecimal {
  if (token.id == WFTM_ADDRESS) {
    return BIG_DECIMAL_ONE
  }

  // loop through whitelist and check if paired with any
  for (let i = 0; i < WHITELIST.length; ++i) {
    const pairAddress = factoryContract.getPair(Address.fromString(token.id), Address.fromString(WHITELIST[i]), stable)
    if (pairAddress.toHexString() == ADDRESS_ZERO) continue

    const pair = Pair.load(pairAddress.toHexString())
    if (!pair) continue

    if (pair.token0 == token.id && pair.reserveFTM.gt(MINIMUM_LIQUIDITY_THRESHOLD_FTM)) {
      const token1 = Token.load(pair.token1)
      if (token1) {
        return pair.token1Price.times(token1.derivedFTM as BigDecimal) // return token1 per our token * FTM per token 1
      }
    }

    if (pair.token1 == token.id && pair.reserveFTM.gt(MINIMUM_LIQUIDITY_THRESHOLD_FTM)) {
      let token0 = Token.load(pair.token0)
      if (token0) {
        return pair.token0Price.times(token0.derivedFTM) // return token0 per our token * FTM per token 0
      }
    }
  }
  return BIG_DECIMAL_ZERO // nothing was found return 0
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD.
 * If both are, return average of two amounts
 * If neither is, return 0
 */
export function getTrackedVolumeUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
  pair: Pair
): BigDecimal {
  let bundle = getBundle()

  let price0 = token0.derivedFTM.times(bundle.ftmPrice)
  let price1 = token1.derivedFTM.times(bundle.ftmPrice)

  // if less than 5 LP's, require high minimum reserve amount amount or return 0
  if (pair.liquidityProviderCount.lt(BigInt.fromI32(5))) {
    let reserve0USD = pair.reserve0.times(price0)
    let reserve1USD = pair.reserve1.times(price1)
    if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve0USD.plus(reserve1USD).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return BIG_DECIMAL_ZERO
      }
    }
    if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
      if (reserve0USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return BIG_DECIMAL_ZERO
      }
    }
    if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve1USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return BIG_DECIMAL_ZERO
      }
    }
  }

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1)).div(BigDecimal.fromString('2'))
  }

  // take full value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0)
  }

  // take full value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1)
  }

  // neither token is on white list, tracked volume is 0
  return BIG_DECIMAL_ZERO
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedLiquidityUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let bundle = getBundle()

  let price0 = token0.derivedFTM.times(bundle.ftmPrice)
  let price1 = token1.derivedFTM.times(bundle.ftmPrice)

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1))
  }

  // take double value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).times(BigDecimal.fromString('2'))
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1).times(BigDecimal.fromString('2'))
  }

  // neither token is on white list, tracked volume is 0
  return BIG_DECIMAL_ZERO
}
