#!/usr/bin/env bash
# Deploys Squeek Companion to Sepolia through the CREATE2 deterministic deployment proxy, so it lands
# at the address in src/generated/companion.json. Uses your own Foundry keystore account:
#   ./contracts/script/deploy.sh <foundry-account-name>
set -euo pipefail
cd "$(dirname "$0")/../.."
RPC=${SEPOLIA_RPC_URL:-https://ethereum-sepolia-rpc.publicnode.com}
J=src/generated/companion.json
ADDR=$(jq -r .address $J)
if [ "$(cast code "$ADDR" --rpc-url "$RPC")" != "0x" ]; then echo "Already deployed at $ADDR"; exit 0; fi
SALT=$(jq -r .salt $J); INIT=$(jq -r .initCode $J)
cast send "$(jq -r .factory $J)" "${SALT}${INIT#0x}" --account "$1" --rpc-url "$RPC"
echo "Deployed at $ADDR"
