// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.30;

import { Test } from "forge-std/Test.sol";
import { PonsPrivacyAccount } from "../src/PonsPrivacyAccount.sol";
import { PonsPrivacyAccountFactory } from "../src/PonsPrivacyAccountFactory.sol";
import { IPonsPrivacyAccount } from "../src/interfaces/IPonsPrivacyAccount.sol";

interface IERC20PonsFork {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IPonsV2CurveFork {
    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient)
        external
        payable
        returns (uint256 tokensOut);
    function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient)
        external
        returns (uint256 quoteOut);
}

interface IPonsV2FactoryFork {
    struct Socials {
        string twitter;
        string telegram;
        string discord;
        string website;
        string farcaster;
    }

    struct TokenParams {
        string name;
        string symbol;
        string logo;
        string description;
        Socials socials;
        address creatorFeeRecipient;
        uint16 creatorTaxBps;
        bool buybackEnabled;
        bytes32 expectedEconomics;
        bytes32 salt;
    }

    struct LaunchedToken {
        address token;
        address curve;
        address deployer;
        address creatorFeeRecipient;
        address pairToken;
        uint256 graduationThreshold;
        uint24 poolFee;
        int24 tickSpacing;
        uint16 creatorTaxBps;
        bool buybackEnabled;
        uint8 phase;
        uint256 sweptQuote;
        uint256 sweptTokens;
        uint256 sweptAt;
        bool exists;
    }

    function canLaunch(address launcher) external view returns (bool);
    function launchFee() external view returns (uint256);
    function approvedPairTokens(address pairToken) external view returns (bool);
    function previewLaunchEconomics(uint256 launchConfigId, address pairToken)
        external
        view
        returns (bytes32);
    function launchToken(TokenParams calldata params, uint256 launchConfigId, address pairToken)
        external
        payable
        returns (address token, address curve);
    function getLaunchedToken(address token) external view returns (LaunchedToken memory);
}

/// @dev Run `pnpm test:fork`. Without a Robinhood fork this returns before changing state.
contract PonsV2ForkTest is Test {
    uint256 internal constant OWNER_KEY = 0xA11CE;
    uint256 internal constant ACCOUNT_INDEX = 23;
    uint256 internal constant USDG_BUDGET = 100e6;
    uint256 internal constant BUY_AMOUNT = 10e6;

    address internal constant PONS_FACTORY = 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e;
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;

    PonsPrivacyAccountFactory internal accountFactory;
    PonsPrivacyAccount internal account;
    IPonsV2FactoryFork internal pons = IPonsV2FactoryFork(PONS_FACTORY);
    address internal owner;
    address internal relayer;
    address internal predicted;
    address internal token;
    address internal curve;
    uint256 internal deadline;

    function testCounterfactualAccountLaunchesBuysAndSellsOnLivePonsV2() external {
        if (PONS_FACTORY.code.length == 0) return;

        owner = vm.addr(OWNER_KEY);
        relayer = makeAddr("pons-relayer");
        accountFactory = new PonsPrivacyAccountFactory();
        predicted = accountFactory.computeAddress(owner, ACCOUNT_INDEX);
        deadline = block.timestamp + 15 minutes;

        assertEq(predicted.code.length, 0, "account must begin counterfactual");
        assertTrue(pons.canLaunch(predicted), "Pons launch gate must accept derived account");
        assertTrue(pons.approvedPairTokens(USDG), "Pons must still approve USDG");

        deal(USDG, predicted, USDG_BUDGET, true);
        _launch();
        uint256 tokensOut = _buy();
        _sell(tokensOut);
        assertEq(account.nonce(), 3);
    }

    function _launch() internal {
        uint256 launchFee = pons.launchFee();
        bytes32 economics = pons.previewLaunchEconomics(0, USDG);
        IPonsV2FactoryFork.TokenParams memory params = IPonsV2FactoryFork.TokenParams({
            name: "Pons Privacy Fork Proof",
            symbol: "PPFP",
            logo: "",
            description: "STRK20-sanitized execution-account compatibility proof",
            socials: IPonsV2FactoryFork.Socials({
                    twitter: "", telegram: "", discord: "", website: "", farcaster: ""
                }),
            creatorFeeRecipient: predicted,
            creatorTaxBps: 0,
            buybackEnabled: false,
            expectedEconomics: economics,
            salt: keccak256(abi.encode("pons-privacy-fork", predicted, block.number))
        });

        IPonsPrivacyAccount.Call[] memory calls = new IPonsPrivacyAccount.Call[](1);
        calls[0] = IPonsPrivacyAccount.Call({
            target: PONS_FACTORY,
            value: launchFee,
            data: abi.encodeCall(IPonsV2FactoryFork.launchToken, (params, 0, USDG))
        });
        bytes memory signature = _sign(predicted, calls, 0, deadline, launchFee);

        vm.deal(relayer, launchFee);
        vm.prank(relayer);
        (, bytes[] memory results) = accountFactory.deployAndExecute{ value: launchFee }(
            owner, ACCOUNT_INDEX, calls, 0, deadline, address(0), 0, address(0), signature
        );
        (token, curve) = abi.decode(results[0], (address, address));
        account = PonsPrivacyAccount(payable(predicted));

        IPonsV2FactoryFork.LaunchedToken memory launch = pons.getLaunchedToken(token);
        assertTrue(launch.exists);
        assertEq(launch.deployer, predicted, "root wallet leaked into deployer attribution");
        assertEq(
            launch.creatorFeeRecipient, predicted, "creator fees escaped the execution account"
        );
        assertEq(launch.pairToken, USDG);
        assertEq(launch.phase, 0);
    }

    function _buy() internal returns (uint256 tokensOut) {
        IPonsPrivacyAccount.Call[] memory calls = new IPonsPrivacyAccount.Call[](2);
        calls[0] = IPonsPrivacyAccount.Call({
            target: USDG,
            value: 0,
            data: abi.encodeCall(IERC20PonsFork.approve, (curve, BUY_AMOUNT))
        });
        calls[1] = IPonsPrivacyAccount.Call({
            target: curve,
            value: 0,
            data: abi.encodeCall(IPonsV2CurveFork.buy, (BUY_AMOUNT, 1, predicted))
        });
        bytes memory signature = _sign(predicted, calls, 1, deadline, 0);
        vm.prank(relayer);
        bytes[] memory results =
            account.execute(calls, 1, deadline, address(0), 0, address(0), signature);
        tokensOut = abi.decode(results[1], (uint256));
        assertGt(tokensOut, 0);
        assertEq(IERC20PonsFork(token).balanceOf(predicted), tokensOut);
    }

    function _sell(uint256 tokensOut) internal {
        IPonsPrivacyAccount.Call[] memory calls = new IPonsPrivacyAccount.Call[](2);
        calls[0] = IPonsPrivacyAccount.Call({
            target: token,
            value: 0,
            data: abi.encodeCall(IERC20PonsFork.approve, (curve, tokensOut))
        });
        calls[1] = IPonsPrivacyAccount.Call({
            target: curve,
            value: 0,
            data: abi.encodeCall(IPonsV2CurveFork.sell, (tokensOut, 1, predicted))
        });
        bytes memory signature = _sign(predicted, calls, 2, deadline, 0);
        vm.prank(relayer);
        bytes[] memory results =
            account.execute(calls, 2, deadline, address(0), 0, address(0), signature);
        assertGt(abi.decode(results[1], (uint256)), 0);
        assertEq(IERC20PonsFork(token).balanceOf(predicted), 0);
        assertGt(IERC20PonsFork(USDG).balanceOf(predicted), 99e6);
    }

    function _sign(
        address verifyingAccount,
        IPonsPrivacyAccount.Call[] memory calls,
        uint256 nonce,
        uint256 executionDeadline,
        uint256 prefund
    ) internal view returns (bytes memory signature) {
        bytes32[] memory callHashes = new bytes32[](calls.length);
        bytes32 callTypehash = keccak256("Call(address target,uint256 value,bytes data)");
        for (uint256 i; i < calls.length; ++i) {
            callHashes[i] = keccak256(
                abi.encode(callTypehash, calls[i].target, calls[i].value, keccak256(calls[i].data))
            );
        }
        bytes32 domain = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("PonsPrivacyAccount"),
                keccak256("1"),
                block.chainid,
                verifyingAccount
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Execution(bytes32 callsHash,uint256 nonce,uint256 deadline,address feeToken,uint256 feeAmount,address feeRecipient,uint256 prefund)"
                ),
                keccak256(abi.encodePacked(callHashes)),
                nonce,
                executionDeadline,
                address(0),
                0,
                address(0),
                prefund
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OWNER_KEY, digest);
        signature = abi.encodePacked(r, s, v);
    }
}
