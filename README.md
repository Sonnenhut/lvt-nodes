### Showing some stats with the data of the LVT smart contract

Available at: https://sonnenhut.github.io/lvt-nodes/

Shows some stats from data exported from the smart contract.

LVT project: https://www.louverture.finance/

Smart contract: https://snowtrace.io/address/0xff579d6259dedcc80488c9b89d2820bcb5609160

NodeRewardManager smart contract: https://snowtrace.io/address/0x3cf1dff7cce2b7291456bc2089b4bcb2ab5f311a


### Thoughts on the process 

This was a good excercise to learn more about smart contracts and how they work and how you can interact with them.

Some things learned:

 - Contract will be computed/verified by multiple parties, thus storage is openly available and can be read: https://blockchain-academy.hs-mittweida.de/courses/solidity-coding-beginners-to-intermediate/lessons/solidity-12-reading-the-storage/topic/reading-the-ethereum-storage/
 - Even though the contract does not expose a function to be public, you can still read the storage and get the data yourself. Storage allocation is deterministic.
 - Getting all wallet addresses that interacted with a smart contract is not that easy. (traversing all blocks works, though is tedious)
 - API access to eth/avax RPC API is pretty nice, there is even batch support
 - Already learned that, but here again: When you have to process stuff in bulk/batches you also have to re-arrange your code (sometimes heavily)
 - When trying to find data again when you do requests, you can correlate data and request results by order (when you retain keep response ordering correct)
 - I should do more fun things in my free time


https://medium.com/aigang-network/how-to-read-ethereum-contract-storage-44252c8af925
https://ethereum.stackexchange.com/a/26487
https://ethereum.stackexchange.com/questions/49873/how-to-derive-the-storage-key-of-mapping-to-an-account