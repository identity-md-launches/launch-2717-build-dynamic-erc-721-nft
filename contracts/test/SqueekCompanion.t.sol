// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SqueekCompanion, ISqueekCore} from "../src/SqueekCompanion.sol";

interface Vm {
    function prank(address) external;
    function warp(uint256) external;
    function expectRevert(bytes4) external;
    function envOr(string calldata, string calldata) external returns (string memory);
    function createSelectFork(string calldata) external returns (uint256);
}

/// @dev A SqueekCore stand-in for unit tests: settled work per round is set by the test.
contract MockCore {
    uint64 public settled = 100;
    uint64 public genesis = 1_000_000;
    mapping(uint64 => uint64) public cumulative; // cumulative work at the end of a round
    bool public broken;

    function setRound(uint64 round, uint64 cumulativeWork) external {
        cumulative[round] = cumulativeWork;
    }

    function setSettled(uint64 s) external {
        settled = s;
    }

    function breakIt() external {
        broken = true;
    }

    function state() external view returns (ISqueekCore.CoreState memory s) {
        require(!broken, "down");
        s.settledThroughRound = settled;
        s.cumulativeWork = cumulative[settled];
        s.blockHeight = 4135;
        s.blockProgress = 358_220_820; // 35.82% of 1e9
    }

    function configuration() external view returns (ISqueekCore.CoreConfiguration memory c) {
        c.genesisTimestamp = genesis;
        c.roundDuration = 600;
        c.blockUnitsPerBlock = 1e9;
    }

    function roundPage(uint64 afterRound, uint64 throughRound, uint256)
        external
        view
        returns (ISqueekCore.RoundPage memory r)
    {
        r.certifiedThroughRound = throughRound;
        r.start.cumulativeWork = cumulative[afterRound];
        r.end.cumulativeWork = cumulative[throughRound];
    }
}

contract SqueekCompanionTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MockCore mock;
    SqueekCompanion nft;

    function setUp() public {
        mock = new MockCore();
        nft = new SqueekCompanion(ISqueekCore(address(mock)));
        // clock at round 101: settled round 100 is fresh
        vm.warp(1_000_000 + 101 * 600);
    }

    function _flat(uint64 w) internal {
        for (uint64 r = 90; r <= 100; r++) mock.setRound(r, w);
    }

    function test_mintOnePerWallet() public {
        vm.prank(address(0xA11CE));
        uint256 id = nft.mint();
        require(id == 1 && nft.ownerOf(1) == address(0xA11CE), "mint");
        require(nft.mintedBy(address(0xA11CE)) == 1 && nft.totalSupply() == 1, "bookkeeping");
        vm.prank(address(0xA11CE));
        vm.expectRevert(SqueekCompanion.AlreadyMinted.selector);
        nft.mint();
        vm.prank(address(0xB0B));
        require(nft.mint() == 2, "second wallet");
    }

    function test_sleepingWhenNoWork() public {
        _flat(5000);
        SqueekCompanion.Pulse memory p = nft.pulse();
        require(p.online && p.fresh, "fresh");
        require(p.mood == SqueekCompanion.Mood.Sleeping && p.rpm == 0, "sleeping");
        require(p.blockProgressBps == 3582 && p.blockHeight == 4135, "progress");
    }

    function test_zoomingWhenFast() public {
        _flat(5000);
        mock.setRound(100, 5600); // 600 turns in 10 minutes = 60 rpm
        SqueekCompanion.Pulse memory p = nft.pulse();
        require(p.mood == SqueekCompanion.Mood.Zooming && p.rpm == 60 && p.recentWork == 600, "zooming");
    }

    function test_joggingWhenSlow() public {
        _flat(5000);
        mock.setRound(100, 5100); // 10 rpm
        require(nft.pulse().mood == SqueekCompanion.Mood.Jogging, "jogging");
    }

    function test_dozingAfterRecentWork() public {
        _flat(5000);
        mock.setRound(98, 5300);
        mock.setRound(99, 5300);
        mock.setRound(100, 5300);
        SqueekCompanion.Pulse memory p = nft.pulse();
        require(p.mood == SqueekCompanion.Mood.Dozing && p.rpm == 0 && p.recentWork == 300, "dozing");
    }

    function test_staleFeedSleeps() public {
        _flat(5000);
        mock.setRound(100, 5600);
        vm.warp(1_000_000 + 120 * 600);
        SqueekCompanion.Pulse memory p = nft.pulse();
        require(!p.fresh && p.mood == SqueekCompanion.Mood.Sleeping, "stale");
    }

    function test_tokenURINeverRevertsWhenCoreIsDown() public {
        vm.prank(address(0xA11CE));
        nft.mint();
        mock.breakIt();
        require(!nft.pulse().online, "offline");
        require(bytes(nft.tokenURI(1)).length > 100, "uri");
    }

    function test_tokenURIUnmintedReverts() public {
        vm.expectRevert(SqueekCompanion.NotMinted.selector);
        nft.tokenURI(7);
    }

    function test_transfer() public {
        vm.prank(address(0xA11CE));
        nft.mint();
        vm.prank(address(0xA11CE));
        nft.transferFrom(address(0xA11CE), address(0xB0B), 1);
        require(nft.ownerOf(1) == address(0xB0B) && nft.balanceOf(address(0xA11CE)) == 0, "moved");
        // the original minter still cannot mint again
        vm.prank(address(0xA11CE));
        vm.expectRevert(SqueekCompanion.AlreadyMinted.selector);
        nft.mint();
    }

    /// Against the real SqueekCore on a Sepolia fork, when SEPOLIA_RPC_URL is set.
    function test_forkRealCore() public {
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        SqueekCompanion real = new SqueekCompanion(ISqueekCore(0x980B4424c007CAf7a1f3670B48c8EaEf7EbC3d44));
        vm.prank(address(0xA11CE));
        real.mint();
        SqueekCompanion.Pulse memory p = real.pulse();
        require(p.online && p.blockHeight > 0 && p.settledRound > 0, "real core");
        require(bytes(real.tokenURI(1)).length > 1000, "uri");
    }
}
