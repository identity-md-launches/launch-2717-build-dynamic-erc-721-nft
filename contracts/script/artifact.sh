#!/usr/bin/env bash
# Builds the contract and writes src/generated/companion.json for the site: ABI, CREATE2 init code,
# salt and the deterministic address the collection has (or will have) on Sepolia.
set -euo pipefail
cd "$(dirname "$0")/.."
CORE=0x980B4424c007CAf7a1f3670B48c8EaEf7EbC3d44
FACTORY=0x4e59b44847b379578588920cA78FbF26c0B4956C   # deterministic deployment proxy, live on Sepolia
SALT=$(cast keccak "Squeek Companion v1")
forge build --silent
BYTECODE=$(jq -r '.bytecode.object' out/SqueekCompanion.sol/SqueekCompanion.json)
ARGS=$(cast abi-encode "constructor(address)" "$CORE")
INIT="${BYTECODE}${ARGS#0x}"
ADDR=$(cast create2 --deployer "$FACTORY" --salt "$SALT" --init-code "$INIT" | awk '{print $1}')
mkdir -p ../src/generated
jq -n --arg address "$ADDR" --arg core "$CORE" --arg factory "$FACTORY" --arg salt "$SALT" --arg initCode "$INIT" \
  --argjson abi "$(jq '.abi' out/SqueekCompanion.sol/SqueekCompanion.json)" \
  '{address:$address, core:$core, factory:$factory, salt:$salt, initCode:$initCode, abi:$abi}' > ../src/generated/companion.json
echo "$ADDR"
