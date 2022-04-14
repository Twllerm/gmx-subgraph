import { BigInt, Address, Bytes } from "@graphprotocol/graph-ts"
import {
  ReferralStorage,
  GovSetCodeOwner,
  RegisterCode,
  SetCodeOwner,
  SetHandler,
  SetReferrerDiscountShare,
  SetReferrerTier,
  SetTier,
  SetTraderReferralCode
} from "../generated/ReferralStorage/ReferralStorage"
import {
  IncreasePositionReferral,
  DecreasePositionReferral
} from "../generated/PositionManager/PositionManager"
import {
  BatchSend
} from "../generated/BatchSender/BatchSender"
import {
  ReferralVolumeRecord,
  ReferrerStat,
  GlobalStat,
  Tier,
  Referrer,
  UniqueReferral,
  ReferralStat,
  Distribution,
  ReferralCode
} from "../generated/schema"
import {
  timestampToPeriod
} from "../../utils"

class ReferrerResult {
  created: boolean
  entity: Referrer

  constructor(entity: Referrer, created: boolean) {
    this.entity = entity
    this.created = created
  }
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000"
let ZERO = BigInt.fromI32(0)
let ONE = BigInt.fromI32(1)
let BASIS_POINTS_DIVISOR = BigInt.fromI32(10000)


export function handleBatchSend(event: BatchSend): void {
  let typeId = event.params.typeId
  let token = event.params.token.toHexString()
  let receivers = event.params.accounts
  let amounts = event.params.amounts
  for (let i = 0; i < event.params.accounts.length; i++) {
    let receiver = receivers[i].toHexString()
    let amount = amounts[i]
    let id = receiver + ":" + event.transaction.hash.toHexString() + ":" + event.logIndex.toString()
    let entity = new Distribution(id)
    entity.typeId = typeId
    entity.token = token
    entity.receiver = receiver
    entity.amount = amount

    entity.blockNumber = event.block.number
    entity.transactionHash = event.transaction.hash.toHexString()
    entity.timestamp = event.block.timestamp

    entity.save()
  }
}

export function handleDecreasePositionReferral(event: DecreasePositionReferral): void {
  _handleChangePositionReferral(
    event.block.number,
    event.transaction.hash,
    event.logIndex,
    event.block.timestamp,
    event.params.account,
    event.params.sizeDelta,
    event.params.referralCode,
    event.params.referrer
  )
}

export function handleIncreasePositionReferral(event: IncreasePositionReferral): void {
  _handleChangePositionReferral(
    event.block.number,
    event.transaction.hash,
    event.logIndex,
    event.block.timestamp,
    event.params.account,
    event.params.sizeDelta,
    event.params.referralCode,
    event.params.referrer
  )
}

export function handleGovSetCodeOwner(event: GovSetCodeOwner): void {}

export function handleRegisterCode(event: RegisterCode): void {
   let referrerResult = _getOrCreateReferrerWithCreatedFlag(event.params.account.toHexString())
   let referrerCreated = referrerResult.created

   let referralCodeEntity = new ReferralCode(event.params.code.toHexString())
   referralCodeEntity.owner = event.params.account.toHexString()
   referralCodeEntity.code = event.params.code.toHex()
   referralCodeEntity.save()

   let totalReferrerStat = _getOrCreateReferrerStat(event.block.timestamp, "total", event.params.account, event.params.code)
   totalReferrerStat.save()

   let dailyReferrerStat = _getOrCreateReferrerStat(event.block.timestamp, "daily", event.params.account, event.params.code)
   dailyReferrerStat.save()

   let totalGlobalStatEntity = _getOrCreateGlobalStat(event.block.timestamp, "total", null)
   totalGlobalStatEntity.referralCodesCount += ONE
   totalGlobalStatEntity.referralCodesCountCumulative = totalGlobalStatEntity.referralCodesCount
   if (referrerCreated) {
     totalGlobalStatEntity.referrersCount += ONE
     totalGlobalStatEntity.referrersCountCumulative = totalGlobalStatEntity.referrersCount
   }
   totalGlobalStatEntity.save()

   let dailyGlobalStatEntity = _getOrCreateGlobalStat(event.block.timestamp, "daily", totalGlobalStatEntity)
   dailyGlobalStatEntity.referralCodesCount += ONE
   if (referrerCreated) {
     dailyGlobalStatEntity.referrersCount += ONE
   }
   dailyGlobalStatEntity.save()
}

export function handleSetCodeOwner(event: SetCodeOwner): void {
   let referralCodeEntity = ReferralCode.load(event.params.code.toHexString())
   referralCodeEntity.owner = event.params.newAccount.toHexString()
   referralCodeEntity.save()
}

export function handleSetHandler(event: SetHandler): void {}

export function handleSetReferrerDiscountShare(event: SetReferrerDiscountShare): void {
   let entity = _getOrCreateReferrer(event.params.referrer.toHexString())
   entity.discountShare = event.params.discountShare;
   entity.save()
}

export function handleSetReferrerTier(event: SetReferrerTier): void {
   let entity = _getOrCreateReferrer(event.params.referrer.toHexString())
   entity.tierId = event.params.tierId;
   entity.save()
}

export function handleSetTier(event: SetTier): void {
  let entity = _getOrCreateTier(event.params.tierId.toString())
  entity.totalRebate = event.params.totalRebate
  entity.discountShare = event.params.discountShare
  entity.save()
}

export function handleSetTraderReferralCode(event: SetTraderReferralCode): void {}

function _getOrCreateTier(id: String): Tier {
  let entity = Tier.load(id)
  if (entity == null) {
    entity = new Tier(id)
    entity.totalRebate = ZERO
    entity.discountShare = BigInt.fromI32(5000)
    entity.save()
  }
  return entity as Tier
}

function _storeReferralStats(
  timestamp: BigInt,
  referral: Address,
  volume: BigInt,
  discountUsd: BigInt
): void {
  let period = "total"
  let periodTimestamp = timestampToPeriod(timestamp, period)
  let id = period + ":" + periodTimestamp.toString() + ":" + referral.toHexString()

  let entity = ReferralStat.load(id)
  if (entity === null) {
    entity = new ReferralStat(id)
    entity.referral = referral.toHexString()
    entity.volume = ZERO
    entity.volumeCumulative = ZERO
    entity.discountUsd = ZERO
    entity.discountUsdCumulative = ZERO
    entity.timestamp = periodTimestamp
    entity.period = period
  }

  entity.volume += volume
  entity.discountUsd += discountUsd
  entity.volumeCumulative = entity.volume
  entity.discountUsdCumulative = entity.discountUsd

  entity.save()
}

function _getOrCreateGlobalStat(timestamp: BigInt, period: String, totalEntity: GlobalStat | null): GlobalStat {
  let periodTimestamp = timestampToPeriod(timestamp, period)
  let id = period + ":" + periodTimestamp.toString()

  let entity = GlobalStat.load(id)
  if (entity == null) {
    entity = new GlobalStat(id)
    entity.volume = ZERO
    entity.volumeCumulative = ZERO
    entity.totalRebateUsd = ZERO
    entity.totalRebateUsdCumulative = ZERO
    entity.discountUsd = ZERO
    entity.discountUsdCumulative = ZERO
    entity.trades = ZERO
    entity.tradesCumulative = ZERO

    entity.referralCodesCount = ZERO
    entity.referralCodesCountCumulative = ZERO

    entity.referrersCount = ZERO
    entity.referrersCountCumulative = ZERO

    if (totalEntity) {
      entity.referrersCountCumulative = totalEntity.referrersCount
      entity.referralCodesCountCumulative = totalEntity.referralCodesCountCumulative
      entity.volumeCumulative = totalEntity.volumeCumulative
      entity.totalRebateUsdCumulative = totalEntity.totalRebateUsdCumulative
      entity.discountUsdCumulative = totalEntity.discountUsdCumulative
    }

    entity.period = period
    entity.timestamp = periodTimestamp
  }
  return entity as GlobalStat
}

function _storeGlobalStats(
  timestamp: BigInt,
  period: String,
  volume: BigInt,
  totalRebateUsd: BigInt,
  discountUsd: BigInt,
  totalEntity: GlobalStat | null
): GlobalStat {
  let entity = _getOrCreateGlobalStat(timestamp, period, totalEntity);

  entity.volume += volume;
  entity.totalRebateUsd += totalRebateUsd;
  entity.discountUsd += discountUsd;
  entity.trades += BigInt.fromI32(1);

  if (period == "total") {
    totalEntity = entity
  }

  entity.volumeCumulative = totalEntity.volume
  entity.totalRebateUsdCumulative = totalEntity.totalRebateUsd
  entity.discountUsdCumulative = totalEntity.discountUsd
  entity.tradesCumulative = totalEntity.trades
  entity.referrersCountCumulative = totalEntity.referrersCount
  entity.referralCodesCountCumulative = totalEntity.referralCodesCount

  entity.save()

  return entity as GlobalStat;
}

function _getOrCreateReferrerStat(
  timestamp: BigInt,
  period: String,
  referrer: Address,
  referralCode: Bytes
): ReferrerStat {
  let periodTimestamp = timestampToPeriod(timestamp, period)
  let id = period + ":" + periodTimestamp.toString() + ":" + referralCode.toHex() + ":" + referrer.toHexString()

  let entity = ReferrerStat.load(id)
  if (entity === null) {
    entity = new ReferrerStat(id)
    entity.volume = ZERO
    entity.volumeCumulative = ZERO
    entity.trades = ZERO
    entity.tradesCumulative = ZERO
    entity.tradedReferralsCount = ZERO
    entity.tradedReferralsCountCumulative = ZERO

    entity.totalRebateUsd = ZERO
    entity.totalRebateUsdCumulative = ZERO
    entity.discountUsd = ZERO
    entity.discountUsdCumulative = ZERO

    entity.timestamp = periodTimestamp
    entity.referrer = referrer.toHexString()
    entity.referralCode = referralCode.toHex()
    entity.period = period
  }
  return entity as ReferrerStat
}

function _storeReferrerStats(
  timestamp: BigInt,
  period: String,
  volume: BigInt,
  referralCode: Bytes,
  referrer: Address,
  referral: Address,
  totalRebateUsd: BigInt,
  discountUsd: BigInt,
  totalEntity: ReferrerStat | null
): ReferrerStat {
  let entity = _getOrCreateReferrerStat(timestamp, period, referrer, referralCode)
  let isNewReferral = _createUniqueReferralIfNotExist(entity.id, referral)

  if (isNewReferral) {
    entity.tradedReferralsCount += BigInt.fromI32(1)
  }

  entity.volume += volume
  entity.trades += BigInt.fromI32(1)
  entity.totalRebateUsd += totalRebateUsd
  entity.discountUsd += discountUsd
  if (period == "total") {
    entity.volumeCumulative = entity.volume
    entity.totalRebateUsdCumulative = entity.totalRebateUsd
    entity.discountUsdCumulative = entity.discountUsd
    entity.tradesCumulative = entity.trades
    entity.tradedReferralsCountCumulative = entity.tradedReferralsCount
  } else {
    entity.volumeCumulative = totalEntity.volumeCumulative
    entity.tradesCumulative = totalEntity.tradesCumulative
    entity.totalRebateUsdCumulative = totalEntity.totalRebateUsdCumulative
    entity.discountUsdCumulative = totalEntity.discountUsdCumulative
    entity.tradedReferralsCountCumulative = totalEntity.tradedReferralsCount

  }

  entity.save()

  return entity as ReferrerStat
}

function _handleChangePositionReferral(
  blockNumber: BigInt,
  transactionHash: Bytes,
  eventLogIndex: BigInt,
  timestamp: BigInt,
  referral: Address,
  volume: BigInt,
  referralCode: Bytes,
  referrer: Address
): void {
  if (referral.toHexString() == ZERO_ADDRESS || referralCode.toHex() == ZERO_BYTES32) {
    return
  }

  let referrerEntity = _getOrCreateReferrer(referrer.toHexString())
  let tierEntity = Tier.load(referrerEntity.tierId.toString())

  let id = transactionHash.toHexString() + ":" + eventLogIndex.toString()
  let entity = new ReferralVolumeRecord(id)

  entity.volume = volume
  entity.referral = referral.toHexString()
  entity.referralCode = referralCode.toHex()
  entity.referrer = referrer.toHexString()
  entity.tierId = referrerEntity.tierId
  entity.marginFee = BigInt.fromI32(10)
  entity.totalRebate = tierEntity.totalRebate
  entity.discountShare = referrerEntity.discountShare > ZERO
    ? referrerEntity.discountShare : tierEntity.discountShare
  entity.blockNumber = blockNumber
  entity.transactionHash = transactionHash.toHexString()
  entity.timestamp = timestamp

  let feesUsd = entity.volume * entity.marginFee / BASIS_POINTS_DIVISOR
  let totalRebateUsd = feesUsd * entity.totalRebate / BASIS_POINTS_DIVISOR
  let discountUsd = totalRebateUsd * entity.discountShare / BASIS_POINTS_DIVISOR

  entity.totalRebateUsd = totalRebateUsd
  entity.discountUsd = discountUsd

  entity.save()

  let totalEntity = _storeReferrerStats(
    timestamp, "total", volume, referralCode, referrer, referral, totalRebateUsd, discountUsd, null)
  _storeReferrerStats(timestamp, "daily", volume, referralCode, referrer, referral, totalRebateUsd, discountUsd, totalEntity)

  _storeReferralStats(timestamp, referral, volume, discountUsd)

  let totalGlobalStatEntity = _storeGlobalStats(timestamp, "total", volume, totalRebateUsd, discountUsd, null)
  _storeGlobalStats(timestamp, "daily", volume, totalRebateUsd, discountUsd, totalGlobalStatEntity)
}

function _createUniqueReferralIfNotExist(referrerStatId: String, referral: Address): boolean {
  let id = referrerStatId + ":" + referral.toHexString()
  let entity = UniqueReferral.load(id)
  if (entity == null) {
    entity = new UniqueReferral(id)
    entity.referrerStat = referrerStatId
    entity.referral = referral.toHexString()
    entity.save()
    return true
  }
  return false
}

function _getOrCreateReferrer(id: String): Referrer {
  let entity = Referrer.load(id)
  if (entity == null) {
    entity = new Referrer(id)
    entity.tierId = ZERO
    entity.discountShare = ZERO
    entity.save()
  }
  return entity as Referrer
}

function _getOrCreateReferrerWithCreatedFlag(id: String): ReferrerResult {
  let entity = Referrer.load(id)
  let created = false
  if (entity == null) {
    entity = new Referrer(id)
    entity.tierId = ZERO
    entity.discountShare = ZERO
    entity.save()
    created = true
  }
  return new ReferrerResult(entity as Referrer, created)
}