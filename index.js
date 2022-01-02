const Web3 = require('web3');
const fs = require('fs');

const web3Options = {
    keepAlive: true,
    withCredentials: false,
    timeout: 20000 // ms
};

(async () => {
    let httpProvider = new Web3.providers.HttpProvider("https://api.avax.network/ext/bc/C/rpc", web3Options);
    const web3 = new Web3(httpProvider);
    const outputFile = "lvtnoders.json";

    const lvtAddress = "0xff579d6259dEDcc80488c9b89d2820bCb5609160";
    const lvtNodeRewardAddrSlot = 13; // variable nodeRewardManager in LVT
    const nodeOwnersSlot = 0; // variable nodeOwners#keys (dynamic array)
    const nodesOfUserSlot = 4; // variable _nodesOfUser
    const bnOne = web3.utils.toBN(1000000000).mul(web3.utils.toBN(1000000000))

    let nodeRewardManagementAddress = await web3.eth.getStorageAt(lvtAddress, lvtNodeRewardAddrSlot).then(n => asAddress(n));
    console.log("nodeRewardManager addr: ", nodeRewardManagementAddress)

    function asAddress(hex) {
        return web3.utils.leftPad(web3.utils.numberToHex(web3.utils.toBN(hex)), 40);
    }

    function asStorageValue(hex) {
        return web3.utils.leftPad(web3.utils.numberToHex(web3.utils.toBN(hex)), 64);
    }

    function addStorageHex(inHex, toAdd) {
        const incBN = web3.utils.toBN(inHex).addn(toAdd);
        const hex = web3.utils.numberToHex(incBN);
        return web3.utils.leftPad(hex, 64);
    }

    // higher-level function to batch individual requests/calls
    async function batchedRequests(batchCompatibleReq, callParameters) {
        // promise-ify requests
        let workload = callParameters.map((fnParams, idx) => {
            if (!Array.isArray(fnParams)) { fnParams = [fnParams]; }
            return (batch) => {
                return new Promise(function (resolve, reject) {
                    let paramsWithCallBack = [...fnParams];
                    paramsWithCallBack.push((err, res) => {
                        if (err) {
                            return reject(err);
                        }
                        resolve(res)
                    });
                    batch.add(batchCompatibleReq.apply(null, paramsWithCallBack));
                });
            }
        });

        const maxBatchSize = 40;
        const maxParallelRequests = 50;
        let reqPromises = [];
        // this will fire all batched requests. (could be improved to limit sending X in parallel)
        for (let idx = 0; idx < workload.length; idx += maxBatchSize) {
            let batch = new web3.eth.BatchRequest();
            workload.slice(idx, idx + maxBatchSize)
                .forEach(addToBatch => reqPromises.push(addToBatch(batch)));
            batch.execute();

            // throttle a little bit to not run into dirty http 500
            if ((reqPromises.length / maxBatchSize) % maxParallelRequests === 0) {
                console.log("... throttling")
                await Promise.all(reqPromises)
                //new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
        return await Promise.all(reqPromises);
    }

    async function loadDynamicArray(contractAddress, storageSlot) {
        let arrSize = await web3.eth.getStorageAt(contractAddress, storageSlot).then(hex => web3.utils.hexToNumber(hex));
        let hexIdx = web3.utils.soliditySha3(storageSlot);

        let slotAddresses = [...Array(arrSize).keys()].map(off => addStorageHex(hexIdx, off));
        let args = slotAddresses.map(slot => {
            let arr = [];
            arr.push(contractAddress)
            arr.push(slot);
            return arr;
        });
        return await batchedRequests(web3.eth.getStorageAt.request, args);
    }

    async function loadLVTAllNodeValueOf(wallets) {
        let payloads = wallets.map(wallet => {
            let funData = web3.eth.abi.encodeFunctionCall({
                name: 'getAllNodeValueOf',
                type: 'function',
                inputs: [{
                    type: 'address',
                    name: 'account'
                }]
            }, [wallet]);
            return {
                to: lvtAddress,
                data: funData
            }
        });


        return (await batchedRequests(web3.eth.call.request, payloads))
            .map(value => web3.utils.toBN(value).div(bnOne).toNumber());
    }

    async function loadTotalRewardAvail(wallets) {
        let structSize = 7;
        let nodesOfUser = {};
        // resolve the slot of the value of "mapping(address => NodeEntity[]) private _nodesOfUser;", which is the size of the dynamic array
        let nodeCntReqParams = wallets
            .map(walletAddress => web3.utils.soliditySha3(asStorageValue(walletAddress), nodesOfUserSlot))
            .map(slot => [nodeRewardManagementAddress, slot]);

        let nodeCnts = (await batchedRequests(web3.eth.getStorageAt.request, nodeCntReqParams)).map(value => web3.utils.toDecimal(value));
        wallets.forEach((wallet, idx) => nodesOfUser[wallet] = { nodeCnt: nodeCnts[idx]});

        // request params to load the parts of the NodeEntity struct for all nodes of all wallets
        // is a flat list of all storages to query, have to make sure to read them in correct order later on
        let nodeEntityReqParams = wallets.map(walletAddress => {
            let arrSizeHash = web3.utils.soliditySha3(asStorageValue(walletAddress), nodesOfUserSlot);
            let nodesOfUserHash = web3.utils.soliditySha3(arrSizeHash);

            return [...Array(nodesOfUser[walletAddress].nodeCnt).keys()]
                .map(nodeIdx => {
                    let off = nodeIdx * structSize;
                    // THE OFFSETS IN STORAGE DONT MATCH THE CONTRACT!
                    // Seems like the NodeRewardManager contract sourcecode has been changed
                    let lastCompoundTimeHex = addStorageHex(nodesOfUserHash, off + 2);
                    let rewardMultHex = addStorageHex(nodesOfUserHash, off + 4);
                    let nodeValueHex = addStorageHex(nodesOfUserHash, off + 5);

                    return [[nodeRewardManagementAddress, lastCompoundTimeHex],
                        [nodeRewardManagementAddress, rewardMultHex],
                        [nodeRewardManagementAddress, nodeValueHex]]
                }).flat();
        }).flat();
        let nums = (await batchedRequests(web3.eth.getStorageAt.request, nodeEntityReqParams)).map(value => web3.utils.toBN(value));

        const nowSecs = Date.now() / 1000;
        const secsPerDay = 86400;

        let csr = 0;
        wallets.forEach(walletAddress => {
            let currNodes = nodesOfUser[walletAddress];
            [...Array(currNodes.nodeCnt).keys()].forEach(_ => {

                const nlastCompoundTimeEpoch = nums[csr];
                const bnrewardMult = nums[csr + 1];
                const bnnodeValue = nums[csr + 2];

                const lvtPerDay = bnnodeValue.mul(bnrewardMult.muln(5)) // 0.5 pcnt plus multiplier
                    .divn(100000).divn(1000).div(bnOne);

                const daysSinceLastCompound = (nowSecs - nlastCompoundTimeEpoch.toNumber()) / secsPerDay;
                const unclaimed = Math.trunc(lvtPerDay.toNumber() * daysSinceLastCompound);
                currNodes.unclaimed = (currNodes.unclaimed || 0) + unclaimed;

                csr += 3;
            })
        })

        return nodesOfUser;
    }

    // --- Starting to fetch data ---

    let wallets = (await loadDynamicArray(nodeRewardManagementAddress, nodeOwnersSlot)).map(hex => asAddress(hex));
    console.log("fetched wallets: ", wallets.length)

    let values = await loadLVTAllNodeValueOf(wallets);
    console.log("fetched all nodeValueOf: ", wallets.length);

    let nodesOfUser = await loadTotalRewardAvail(wallets) /* returns {walletId: {nodeCnt, reward}}*/;
    console.log("fetched nodesOfUser: ", Object.keys(nodesOfUser).length)

    let walletWithData = {};
    [...Array(wallets.length).keys()]
        .sort((left, right) => values[right] - values[left]) // sort by size desc
        .forEach(idx => {
            let wallet = wallets[idx];
            let locked = values[idx];
            walletWithData[wallet] = Object.assign({}, nodesOfUser[wallet], {locked})
        });

    let res = {
        exportTime: Date.now(),
        data: walletWithData
    }
    fs.writeFile(outputFile, JSON.stringify(res), err => {
        if (err) {
            console.error(err);
        }
    })

    console.log("finished")
})()

// -- helpers for checking out the storage slots
/*
 for (let i = 0; i < 35; i++) {
     //let data = await web3.eth.getStorageAt(lvtAddress, i)
     let data = await web3.eth.getStorageAt(lvtAddress, i)
     console.log(i, data, web3.utils.toAscii(data))
 }
 await loadDynamicArray(nodeRewardManagementAddress, 0);
*/