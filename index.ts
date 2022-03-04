import algosdk from 'algosdk'
import fs from 'fs'

const server = 'http://localhost'
const token = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

const algodClient = new algosdk.Algodv2(token, server, 4001)
const kmdClient = new algosdk.Kmd(token, server, 4002)
const kmdWallet = 'unencrypted-default-wallet'
const kmdPassword = ''

// Based on https://github.com/algorand-devrel/demo-abi/blob/master/js/sandbox.ts
async function getAccounts (): Promise<algosdk.Account[]> {
  const wallets = await kmdClient.listWallets()

  // find kmdWallet
  let walletId
  for (const wallet of wallets.wallets) {
    if (wallet.name === kmdWallet) walletId = wallet.id
  }
  if (walletId === undefined) throw Error('No wallet named: ' + kmdWallet)

  // get handle
  const handleResp = await kmdClient.initWalletHandle(walletId, kmdPassword)
  const handle = handleResp.wallet_handle_token

  // get account keys
  const addresses = await kmdClient.listKeys(handle)
  const acctPromises = []
  for (const addr of addresses.addresses) {
    acctPromises.push(kmdClient.exportKey(handle, kmdPassword, addr))
  }
  const keys = await Promise.all(acctPromises)

  // release handle
  kmdClient.releaseWalletHandle(handle)

  // return all algosdk.Account objects derived from kmdWallet
  return keys.map((k) => {
    const addr = algosdk.encodeAddress(k.private_key.slice(32))
    const acct = { sk: k.private_key, addr: addr } as algosdk.Account
    return acct
  })
}

// https://developer.algorand.org/docs/get-details/dapps/smart-contracts/frontend/apps/#create
async function compileProgram (programSource: string) {
  const encoder = new TextEncoder()
  const programBytes = encoder.encode(programSource)
  const compileResponse = await algodClient.compile(programBytes).do()
  const compiledBytes = new Uint8Array(Buffer.from(compileResponse.result, 'base64'))
  return compiledBytes
}

interface GlobalStateDeltaValue {
    action: number,
    bytes?: string
    uint?: number
}

interface GlobalStateDelta {
    key: string
    value: GlobalStateDeltaValue
}

interface ReadableGlobalStateDelta {
    [key: string]: string | number | bigint | undefined
}

function getReadableGlobalState (delta: Array<GlobalStateDelta>) {
  const r = {} as ReadableGlobalStateDelta

  delta.forEach(d => {
    const key = Buffer.from(d.key, 'base64').toString('utf8')
    let value = null

    if (d.value.bytes) {
      // first see if it's a valid address
      const b = new Uint8Array(Buffer.from(d.value.bytes as string, 'base64'))
      value = algosdk.encodeAddress(b)

      // then decode as string
      if (!algosdk.isValidAddress(value)) {
        value = Buffer.from(d.value.bytes as string, 'base64').toString()
      }
    } else {
      value = d.value.uint
    }

    r[key] = value
  })

  return r
}

async function createApp (creator: algosdk.Account) {
  const approval = await compileProgram(fs.readFileSync('approval.teal').toString())
  const clear = await compileProgram(fs.readFileSync('clear.teal').toString())

  const creationObj = {
    suggestedParams: await algodClient.getTransactionParams().do(),
    from: creator.addr,
    numGlobalByteSlices: 2,
    numGlobalInts: 1,
    approvalProgram: approval,
    clearProgram: clear
  }

  // @ts-ignore
  const appTxn = algosdk.makeApplicationCreateTxnFromObject(creationObj).signTxn(creator.sk)
  const { txId } = await algodClient.sendRawTransaction(appTxn).do()

  return await algosdk.waitForConfirmation(algodClient, txId, 3)

}

async function getAppCallTransaction(caller: algosdk.Account, appID: number) {
  const appObj = {
    suggestedParams: await algodClient.getTransactionParams().do(),
    from: caller.addr,
    appIndex: appID,
  }

  // @ts-ignore
  return algosdk.makeApplicationCallTxnFromObject(appObj).signTxn(caller.sk)
}

async function fundAccount(from: algosdk.Account, to: algosdk.Account, amount: number) {
  const payObj = {
    suggestedParams: await algodClient.getTransactionParams().do(),
    from: from.addr,
    to: to.addr,
    amount: amount
  }

  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject(payObj).signTxn(from.sk)
  const { txId } = await algodClient.sendRawTransaction(txn).do()
  await algosdk.waitForConfirmation(algodClient, txId, 3)
}

async function closeAccount(accountToClose: algosdk.Account, closeTo: algosdk.Account) {
  const txnObj = {
    suggestedParams: await algodClient.getTransactionParams().do(),
    from: accountToClose.addr,
    to: accountToClose.addr,
    amount: 0,
    closeTo: closeTo
  }

  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject(txnObj).signTxn(accountToClose.sk)
  const { txId } = await algodClient.sendRawTransaction(txn).do()
  await algosdk.waitForConfirmation(algodClient, txId, 3)
}

describe('Approval program', () => {
  let funder: algosdk.Account
  let testAccount: algosdk.Account
  let appID: number
  let globalState: ReadableGlobalStateDelta
  let nextYearGlobalState: ReadableGlobalStateDelta

  beforeAll(async () => {
    const accounts = await getAccounts()
    funder = accounts[0]

    // create a new account to avoid app creation limit
    testAccount = algosdk.generateAccount()
    await fundAccount(funder, testAccount, 10_000_000)

    const createResult = await createApp(testAccount)
    appID = createResult['application-index']

    const appCallTxn = await getAppCallTransaction(testAccount, appID)

    // add 1 year to current epoch time for the dryrun
    const nextYearDryRunReq = await algosdk.createDryrun({
      client: algodClient,
      txns: [algosdk.decodeSignedTransaction(appCallTxn)],
      latestTimestamp: Math.floor((Date.now() / 1000)) + 60*60*24*365
    })

    // execute dryrun before submitting actual transaction
    const nextYearDryRun = await algodClient.dryrun(nextYearDryRunReq).do()
    nextYearGlobalState = getReadableGlobalState(nextYearDryRun.txns[0]['global-delta'])

    // submit transaction
    const { txId } = await algodClient.sendRawTransaction(appCallTxn).do()
    const appCallResult = await algosdk.waitForConfirmation(algodClient, txId, 3)
    globalState = getReadableGlobalState(appCallResult['global-state-delta'])
  })

  it('puts the caller address in global state', () => {
    expect(globalState.Caller).toBe(testAccount.addr)
  })

  it('puts "Hello World!" in global state', () => {
    expect(globalState.Message).toBe('Hello World!')
  })

  it('puts the current year in global state', () => {
    const currentYear = (new Date(Date.now())).getFullYear()
    expect(globalState.Year).toBe(currentYear)
    expect(nextYearGlobalState.Year).toBe(currentYear + 1)
  })

  afterAll(async () => {
    await closeAccount(testAccount, funder)
  })
})
