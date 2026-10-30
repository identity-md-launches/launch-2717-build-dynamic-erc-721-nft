// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev The read-only part of SqueekCore that the companion uses.
interface ISqueekCore {
    struct CoreState {
        uint64 settledThroughRound;
        uint64 cumulativeWork;
        uint96 cumulativeBlockUnits;
        uint64 blockHeight;
        uint96 blockProgress;
        uint32 workPerThousandBlocks;
        uint256 authorizationNonce;
        bool paused;
    }

    struct CoreConfiguration {
        bytes32 streamId;
        uint64 genesisTimestamp;
        uint64 roundDuration;
        uint64 maxWorkPerRound;
        uint16 maxRoundsPerBatch;
        address guardian;
        address reporter;
        uint32 initialWorkPerThousandBlocks;
        uint64 targetBlocksPerActiveRound;
        uint64 difficultySmoothingRounds;
        uint96 blockUnitsPerBlock;
    }

    struct LedgerPosition {
        uint64 cumulativeWork;
        uint96 cumulativeBlockUnits;
        uint32 workPerThousandBlocks;
    }

    struct RoundCheckpoint {
        uint64 roundId;
        uint64 cumulativeWork;
        uint96 cumulativeBlockUnits;
        uint32 workPerThousandBlocks;
        bytes32 dataHash;
    }

    struct RoundPage {
        uint64 certifiedThroughRound;
        LedgerPosition start;
        LedgerPosition end;
        RoundCheckpoint[] rounds;
    }

    function state() external view returns (CoreState memory);
    function configuration() external view returns (CoreConfiguration memory);
    function roundPage(uint64 afterRound, uint64 throughRound, uint256 maxRecords)
        external
        view
        returns (RoundPage memory);
}

/// @title Squeek Companion
/// @notice A free ERC-721, one per wallet, whose traits and artwork are read live from SqueekCore
///         on every tokenURI call. No owner, no admin, no keeper: the metadata changes because the
///         hamster's wheel work settles on SqueekCore, nothing else.
contract SqueekCompanion {
    // ---------------------------------------------------------------- ERC-721 storage

    string public constant name = "Squeek Companion";
    string public constant symbol = "SQKC";

    ISqueekCore public immutable core;

    uint256 public totalSupply;
    mapping(uint256 => address) private _ownerOf;
    mapping(address => uint256) private _balanceOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    /// @notice The token a wallet minted, 0 if it has not minted. One mint per wallet, for ever.
    mapping(address => uint256) public mintedBy;

    event Transfer(address indexed from, address indexed to, uint256 indexed id);
    event Approval(address indexed owner, address indexed spender, uint256 indexed id);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    error AlreadyMinted();
    error NotMinted();
    error NotAuthorized();
    error InvalidRecipient();
    error UnsafeRecipient();

    // ---------------------------------------------------------------- moods

    enum Mood {
        Sleeping, // no wheel work in the recent settled rounds, or the feed is stale
        Dozing, // wheel work earlier in the window, none in the latest round
        Jogging, // turning in the latest round
        Zooming // turning fast in the latest round
    }

    /// @notice Average wheel rpm (in the latest settled round) at and above which a companion zooms.
    uint256 public constant ZOOM_RPM = 40;
    /// @notice Rounds looked back for "recent" work.
    uint64 public constant WINDOW_ROUNDS = 3;
    /// @notice Settled rounds may lag the clock by this many rounds before the feed counts as stale.
    uint64 public constant STALE_ROUNDS = 6;

    struct Pulse {
        bool online; // SqueekCore answered
        bool fresh; // settlement is within STALE_ROUNDS of the clock
        Mood mood;
        uint256 rpm; // average revolutions per minute in the latest settled round
        uint256 recentWork; // wheel turns in the last WINDOW_ROUNDS settled rounds
        uint64 settledRound;
        uint64 blockHeight;
        uint256 blockProgressBps; // progress through the current Squeek block, 0-9999
        uint64 cumulativeWork;
    }

    constructor(ISqueekCore core_) {
        core = core_;
    }

    // ---------------------------------------------------------------- mint

    /// @notice Mint your companion. Free, one per wallet.
    function mint() external returns (uint256 id) {
        if (mintedBy[msg.sender] != 0) revert AlreadyMinted();
        id = ++totalSupply;
        mintedBy[msg.sender] = id;
        _ownerOf[id] = msg.sender;
        unchecked {
            _balanceOf[msg.sender]++;
        }
        emit Transfer(address(0), msg.sender, id);
    }

    // ---------------------------------------------------------------- live data

    /// @notice The hamster's current state as SqueekCore records it. Never reverts.
    function pulse() public view returns (Pulse memory p) {
        ISqueekCore.CoreState memory s;
        ISqueekCore.CoreConfiguration memory c;
        try core.state() returns (ISqueekCore.CoreState memory s_) {
            s = s_;
        } catch {
            return p;
        }
        try core.configuration() returns (ISqueekCore.CoreConfiguration memory c_) {
            c = c_;
        } catch {
            return p;
        }
        p.online = true;
        p.settledRound = s.settledThroughRound;
        p.blockHeight = s.blockHeight;
        p.cumulativeWork = s.cumulativeWork;
        if (c.blockUnitsPerBlock != 0) {
            p.blockProgressBps = (uint256(s.blockProgress) * 10_000) / c.blockUnitsPerBlock;
            if (p.blockProgressBps > 9_999) p.blockProgressBps = 9_999;
        }

        uint256 roundsNow =
            (c.roundDuration == 0 || block.timestamp < c.genesisTimestamp)
                ? 0
                : (block.timestamp - c.genesisTimestamp) / c.roundDuration;
        p.fresh = !s.paused && roundsNow <= uint256(s.settledThroughRound) + STALE_ROUNDS;

        uint64 settled = s.settledThroughRound;
        if (settled != 0) {
            uint64 window = settled < WINDOW_ROUNDS ? settled : WINDOW_ROUNDS;
            p.recentWork = _work(settled - window, settled, window);
            uint256 lastWork = _work(settled - 1, settled, 1);
            if (c.roundDuration != 0) p.rpm = (lastWork * 60) / c.roundDuration;
            if (p.fresh) {
                if (lastWork != 0) p.mood = p.rpm >= ZOOM_RPM ? Mood.Zooming : Mood.Jogging;
                else if (p.recentWork != 0) p.mood = Mood.Dozing;
            }
        }
    }

    /// @dev Wheel turns settled in (afterRound, throughRound]; 0 when SqueekCore cannot say.
    function _work(uint64 afterRound, uint64 throughRound, uint256 maxRecords) private view returns (uint256) {
        try core.roundPage(afterRound, throughRound, maxRecords) returns (ISqueekCore.RoundPage memory r) {
            if (r.end.cumulativeWork < r.start.cumulativeWork) return 0;
            return r.end.cumulativeWork - r.start.cumulativeWork;
        } catch {
            return 0;
        }
    }

    // ---------------------------------------------------------------- metadata

    function tokenURI(uint256 id) external view returns (string memory) {
        if (_ownerOf[id] == address(0)) revert NotMinted();
        Pulse memory p = pulse();
        string memory moodName = _moodName(p);
        string memory json = string.concat(
            '{"name":"Squeek Companion #',
            _str(id),
            '","description":"A hamster companion whose mood follows the real Squeekchain wheel. Traits are read from SqueekCore on Sepolia every time this metadata is fetched.","image":"data:image/svg+xml;base64,',
            _b64(bytes(_svg(id, p, moodName))),
            '","attributes":[',
            _attrs(id, p, moodName),
            "]}"
        );
        return string.concat("data:application/json;base64,", _b64(bytes(json)));
    }

    function _attrs(uint256 id, Pulse memory p, string memory moodName) private pure returns (string memory) {
        return string.concat(
            '{"trait_type":"Mood","value":"',
            moodName,
            '"},{"trait_type":"Style","value":"',
            p.mood >= Mood.Jogging ? "Energetic" : "Resting",
            '"},{"trait_type":"Wheel RPM","display_type":"number","value":',
            _str(p.rpm),
            '},{"trait_type":"Squeek Block","display_type":"number","value":',
            _str(p.blockHeight),
            '},{"trait_type":"Block Progress","display_type":"boost_percentage","value":',
            _str(p.blockProgressBps / 100),
            '},{"trait_type":"Settled Round","display_type":"number","value":',
            _str(p.settledRound),
            '},{"trait_type":"Feed","value":"',
            !p.online ? "Offline" : p.fresh ? "Live" : "Stale",
            '"},{"trait_type":"Fur","value":"',
            _furName(id),
            '"}'
        );
    }

    function _moodName(Pulse memory p) private pure returns (string memory) {
        if (!p.online) return "Offline";
        if (p.mood == Mood.Zooming) return "Zooming";
        if (p.mood == Mood.Jogging) return "Jogging";
        if (p.mood == Mood.Dozing) return "Dozing";
        return "Sleeping";
    }

    function _furName(uint256 id) private pure returns (string memory) {
        uint256 f = uint256(keccak256(abi.encode(id))) % 4;
        return f == 0 ? "Golden" : f == 1 ? "Cinnamon" : f == 2 ? "Cream" : "Smoke";
    }

    function _furColor(uint256 id) private pure returns (string memory) {
        uint256 f = uint256(keccak256(abi.encode(id))) % 4;
        return f == 0 ? "#E8A54B" : f == 1 ? "#C7743F" : f == 2 ? "#F1DDB8" : "#A79E95";
    }

    function _svg(uint256 id, Pulse memory p, string memory moodName) private pure returns (string memory) {
        bool active = p.mood >= Mood.Jogging;
        // the wheel's arc shows block progress: circumference of r=120 is ~754
        uint256 arc = (p.blockProgressBps * 754) / 10_000;
        string memory head = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" font-family="ui-sans-serif,system-ui,sans-serif">',
            '<rect width="400" height="400" fill="',
            active ? "#FFE3A3" : "#1E2340",
            '"/>',
            active
                ? '<g stroke="#F08A24" stroke-width="6" stroke-linecap="round" opacity=".7"><path d="M40 150h50M28 190h56M40 230h44"/></g>'
                : '<circle cx="330" cy="70" r="26" fill="#F4E9C8"/><circle cx="342" cy="62" r="24" fill="#1E2340"/><g fill="#F4E9C8"><circle cx="60" cy="60" r="2"/><circle cx="120" cy="40" r="1.5"/><circle cx="260" cy="36" r="2"/><circle cx="90" cy="110" r="1.5"/></g>',
            '<circle cx="200" cy="200" r="120" fill="none" stroke="',
            active ? "#F3C46B" : "#2E3560",
            '" stroke-width="14"/><circle cx="200" cy="200" r="120" fill="none" stroke="',
            active ? "#F08A24" : "#7C86C9",
            '" stroke-width="14" stroke-linecap="round" stroke-dasharray="',
            string.concat(_str(arc), " 754"),
            '" transform="rotate(-90 200 200)"/>'
        );
        return string.concat(head, _hamster(id, active), _caption(p, moodName, active), "</svg>");
    }

    function _hamster(uint256 id, bool active) private pure returns (string memory) {
        string memory fur = _furColor(id);
        if (active) {
            return string.concat(
                '<g transform="rotate(-8 200 230)"><ellipse cx="200" cy="232" rx="74" ry="56" fill="',
                fur,
                '"/><ellipse cx="206" cy="246" rx="44" ry="30" fill="#FFF4E0"/><circle cx="150" cy="186" r="16" fill="',
                fur,
                '"/><circle cx="246" cy="186" r="16" fill="',
                fur,
                '"/><circle cx="176" cy="220" r="9" fill="#2A2018"/><circle cx="226" cy="220" r="9" fill="#2A2018"/><circle cx="179" cy="217" r="3" fill="#fff"/><circle cx="229" cy="217" r="3" fill="#fff"/><ellipse cx="201" cy="238" rx="7" ry="5" fill="#E46A6A"/><path d="M190 250q11 10 22 0" stroke="#2A2018" stroke-width="3" fill="none" stroke-linecap="round"/><g fill="#E9A6A0"><ellipse cx="160" cy="288" rx="14" ry="8"/><ellipse cx="244" cy="288" rx="14" ry="8"/></g></g>'
            );
        }
        return string.concat(
            '<ellipse cx="200" cy="262" rx="84" ry="42" fill="',
            fur,
            '"/><ellipse cx="200" cy="276" rx="56" ry="20" fill="#FFF4E0"/><circle cx="148" cy="236" r="14" fill="',
            fur,
            '"/><circle cx="252" cy="236" r="14" fill="',
            fur,
            '"/><path d="M168 258q10 8 20 0M212 258q10 8 20 0" stroke="#2A2018" stroke-width="3" fill="none" stroke-linecap="round"/><ellipse cx="200" cy="270" rx="6" ry="4" fill="#E46A6A"/><text x="262" y="196" fill="#F4E9C8" font-size="28" font-weight="700">z</text><text x="284" y="168" fill="#F4E9C8" font-size="22" font-weight="700">z</text>'
        );
    }

    function _caption(Pulse memory p, string memory moodName, bool active) private pure returns (string memory) {
        string memory ink = active ? "#3A2410" : "#F4E9C8";
        return string.concat(
            '<text x="24" y="368" fill="',
            ink,
            '" font-size="26" font-weight="700">',
            moodName,
            '</text><text x="376" y="368" text-anchor="end" fill="',
            ink,
            '" font-size="16">',
            _str(p.rpm),
            " rpm \xC2\xB7 block ",
            _str(p.blockHeight),
            " \xC2\xB7 ",
            _str(p.blockProgressBps / 100),
            "%</text>"
        );
    }

    // ---------------------------------------------------------------- ERC-721

    function ownerOf(uint256 id) public view returns (address owner) {
        owner = _ownerOf[id];
        if (owner == address(0)) revert NotMinted();
    }

    function balanceOf(address owner) external view returns (uint256) {
        if (owner == address(0)) revert InvalidRecipient();
        return _balanceOf[owner];
    }

    function approve(address spender, uint256 id) external {
        address owner = ownerOf(id);
        if (msg.sender != owner && !isApprovedForAll[owner][msg.sender]) revert NotAuthorized();
        getApproved[id] = spender;
        emit Approval(owner, spender, id);
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 id) public {
        if (from != ownerOf(id)) revert NotAuthorized();
        if (to == address(0)) revert InvalidRecipient();
        if (msg.sender != from && !isApprovedForAll[from][msg.sender] && msg.sender != getApproved[id]) {
            revert NotAuthorized();
        }
        unchecked {
            _balanceOf[from]--;
            _balanceOf[to]++;
        }
        _ownerOf[id] = to;
        delete getApproved[id];
        emit Transfer(from, to, id);
    }

    function safeTransferFrom(address from, address to, uint256 id) external {
        safeTransferFrom(from, to, id, "");
    }

    function safeTransferFrom(address from, address to, uint256 id, bytes memory data) public {
        transferFrom(from, to, id);
        if (to.code.length != 0) {
            try IERC721Receiver(to).onERC721Received(msg.sender, from, id, data) returns (bytes4 r) {
                if (r != IERC721Receiver.onERC721Received.selector) revert UnsafeRecipient();
            } catch {
                revert UnsafeRecipient();
            }
        }
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 // ERC-165
            || interfaceId == 0x80ac58cd // ERC-721
            || interfaceId == 0x5b5e139f; // ERC-721 Metadata
    }

    // ---------------------------------------------------------------- encoding

    function _str(uint256 v) private pure returns (string memory) {
        if (v == 0) return "0";
        uint256 len;
        for (uint256 t = v; t != 0; t /= 10) len++;
        bytes memory b = new bytes(len);
        for (; v != 0; v /= 10) b[--len] = bytes1(uint8(48 + (v % 10)));
        return string(b);
    }

    function _b64(bytes memory data) private pure returns (string memory) {
        bytes memory table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        uint256 len = data.length;
        if (len == 0) return "";
        bytes memory out = new bytes(4 * ((len + 2) / 3));
        uint256 j;
        for (uint256 i = 0; i < len; i += 3) {
            uint256 n = uint256(uint8(data[i])) << 16;
            if (i + 1 < len) n |= uint256(uint8(data[i + 1])) << 8;
            if (i + 2 < len) n |= uint256(uint8(data[i + 2]));
            out[j++] = table[(n >> 18) & 63];
            out[j++] = table[(n >> 12) & 63];
            out[j++] = i + 1 < len ? table[(n >> 6) & 63] : bytes1("=");
            out[j++] = i + 2 < len ? table[n & 63] : bytes1("=");
        }
        return string(out);
    }
}

interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 id, bytes calldata data)
        external
        returns (bytes4);
}
