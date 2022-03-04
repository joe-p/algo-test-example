# Overview
This repository is an example of how one can leverage the JavaScript Algorand SDK and Jest to test smart contracts.

## The Contract

The application written in pyteal, `contracy.py`, is a very simple application that is soley used to demontrate how one can approach application testing. This would have no real use in production and is soley for the purpose of this example repository.

## The Rationale

### Why JavaScript?

If you're writing a contract in PyTeal, it might make sense to also write the tests in python. The argument for using JavaScript, however, is that it's the most common language used to interact with algorand in web3 applications. If you write testing for your code in JavaScript, you can create common code that's leveraged in both tests and production.

### Why Sandbox?

One *could* use testnet and a public node to test their applications. This, however, will cause a lot of unecessary congestion on the test network. By using the sandbox, you aren't at the mercy of rate limits and don't have to worry about congestion. You can also use dev mode, which makes transactions occur instantly rather than the typical ~4.5 second block time.

### Why Dryruns?

Most testing can be done by analyzing transactions that are actually sent to a network. The exception, however, is when you want to test a transaction under a specific context. For example, a dryrun can be executed in the future by specifying the latest block timestamp. This sort of testing just isn't possible without dryrun. 

# Enviroment Setup
## Sandbox

TODO

## Setup Jest
1. `npm --init -y`
1. `npm install --save-dev typescript`
1. `npm install --save-dev jest @types/jest`
1. `npm install --save-dev eslint`
1. `npm init @eslint/config` 
    When prompted, sekect the following options (`_yes_` indicates `yes` was selected).

    *Note: These options, and eslint as a whole, isn't necessary but they help with keeping code clean*
    ```
    ✔ How would you like to use ESLint? · style
    ✔ What type of modules does your project use? · esm
    ✔ Which framework does your project use? · none
    ✔ Does your project use TypeScript? · No / _Yes_
    ✔ Where does your code run? · browser
    ✔ How would you like to define a style for your project? · guide
    ✔ Which style guide do you want to follow? · standard
    ✔ What format do you want your config file to be in? · JavaScript
    ```

    You might also need to say yes to the following:

    ```
    Checking peerDependencies of eslint-config-standard@latest
    ✔ The style guide "standard" requires eslint@^7.12.1. You are currently using eslint@8.10.0.
      Do you want to downgrade? · No / _Yes_
    ```
1. `npm install --save-dev eslint-plugin-jest`
1. `npm install algosdk`
1. Populate `scripts` and `jest` keys in `package.json`
    ```
      "scripts": {
        "test": "./contract.py && tsc && jest",
        "lint": "eslint index.ts",
        "fix": "eslint index.ts --fix"
      },
      "jest": {
        "testMatch": [
          "<rootDir>/index.js"
        ]
      },
    ```
1. Add jest-related options to `.eslint.js`
    ```
      "env": {
            "browser": true,
            "es2021": true,
            "jest/globals": true
        },
    ...
        "plugins": [
            "@typescript-eslint",
            "jest"
        ],
    ```
1. Create `index.ts`

# Writing The Tests

## Importing Modules

In `index.ts` you should start by pulling in all the modules you think you'll need. 

For most basic tests, you really just need `fs` and of course, `algosdk`

```js
import algosdk from 'algosdk'
import fs from 'fs'
```

## Global Variables
Next, you'll want to define some global variables that will be leveraged throughout your tests.

These variables give you objects to interact with the `node` you setup in the "Sandbox" section of "Environment Setup"

```js
const server = 'http://localhost'
const token = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

const algodClient = new algosdk.Algodv2(token, server, 4001)
const kmdClient = new algosdk.Kmd(token, server, 4002)
const kmdWallet = 'unencrypted-default-wallet'
const kmdPassword = ''
```

## Helper Functions

Now we can start defining the meat of these tests. These functions are the tests themselves, but they will be heavily leveraged for testing. 

### getAccounts
This function gets all the accounts in the `unencrypted-default-wallet` wallet and generates the `algosdk.Account` objects for all of them. This is useful for easily signing transactions and getting their respective addresses throughout the tests.

```js
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
```

### compileProgram
This function takes a string containing teal and compiles it down to a `Uint8Array` that can be passed to an application creation transaction

```js
// https://developer.algorand.org/docs/get-details/dapps/smart-contracts/frontend/apps/#create
async function compileProgram (programSource: string) {
  const encoder = new TextEncoder()
  const programBytes = encoder.encode(programSource)
  const compileResponse = await algodClient.compile(programBytes).do()
  const compiledBytes = new Uint8Array(Buffer.from(compileResponse.result, 'base64'))
  return compiledBytes
}
```

### getReadableGlobalState
When reading the global state of an application in the SDK, the global state is in an encoded format:
```js
[
  { key: 'WWVhcg==', value: { action: 2, uint: 2022 } },
  {
    key: 'Q2FsbGVy',
    value: {
      action: 1,
      bytes: 'FI1O7XWgq9t5SUYsJzuOH0pqywXHFSPsIr+IylYhUzA='
    }
  },
  {
    key: 'TWVzc2FnZQ==',
    value: { action: 1, bytes: 'SGVsbG8gV29ybGQh' }
  }
]
```

This function generates global-state key value pairs in unencoded native javascript types (string or int):

```js
{
  Caller: 'OHRQWR3TNKVXI5LKNLAVUGWZFU7LATYAZZCCP53EHXYXJP356WPQ2EZWZI',
  Message: 'Hello World!',
  Year: 2022
}
```

We also need to create some interfaces to get proper types for the global state objects

```js
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
```

### createApp

This function will create the application and return the record from the node once it's confirmed

```js
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
```

### getAppCallTransaction

This function will generate the transaction for calling the application. The transaction isn't submitted to the network (yet) because the tests  will be using the transaction for both dryruns and transactions on the network. 

```js
async function getAppCallTransaction(caller: algosdk.Account, appID: number) {
  const appObj = {
    suggestedParams: await algodClient.getTransactionParams().do(),
    from: caller.addr,
    appIndex: appID,
  }

  // @ts-ignore
  return algosdk.makeApplicationCallTxnFromObject(appObj).signTxn(caller.sk)
}
```

### fundAccount
New accounts are generated for submitting transactions throughout the tests. This is done to prevent the default accounts from running into the app creation limit. 

```js
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
```

### closeAccount
A complimentary function to the one above that returns the funds so that they can be used later

```js
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
```

## Jest Test Suite

### beforeAll
`beforeAll` defines a function to run once before any actual tests are ran. In our case, we want to create the account that will be used for sending transactions, the application, and the dryrun.

```js
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
```

### The Actual Tests
Here is where the actual test results are generated. The variables initialized in the `beforeAll` call will be leveraged gere to verify the values are what they should be. These tests demonstrate how both dry runs and actual transactions can be leveraged for testing in a uniform way.

```js
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
```