// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.30;

import { Test } from "forge-std/Test.sol";
import { PonsPrivacyAccount } from "../src/PonsPrivacyAccount.sol";
import { PonsPrivacyAccountFactory } from "../src/PonsPrivacyAccountFactory.sol";
import { IPonsPrivacyAccount } from "../src/interfaces/IPonsPrivacyAccount.sol";

contract ValueTarget {
    uint256 public value;

    function setValue(uint256 next) external payable returns (uint256) {
        value = next;
        return next;
    }
}

contract PonsPrivacyAccountTest is Test {
    uint256 internal constant OWNER_KEY = 0xA11CE;
    uint256 internal constant ACCOUNT_INDEX = 7;

    PonsPrivacyAccountFactory internal factory;
    ValueTarget internal target;
    address internal owner;
    address internal predicted;

    function setUp() external {
        factory = new PonsPrivacyAccountFactory();
        target = new ValueTarget();
        owner = vm.addr(OWNER_KEY);
        predicted = factory.computeAddress(owner, ACCOUNT_INDEX);
    }

    function testCounterfactualAccountDeploysAndExecutesAtomically() external {
        assertEq(predicted.code.length, 0);
        IPonsPrivacyAccount.Call[] memory calls = _setValueCalls(42);
        uint256 deadline = block.timestamp + 10 minutes;
        bytes memory signature = _sign(predicted, calls, 0, deadline, 0);

        (address deployed, bytes[] memory results) = factory.deployAndExecute(
            owner, ACCOUNT_INDEX, calls, 0, deadline, address(0), 0, address(0), signature
        );

        assertEq(deployed, predicted);
        assertGt(predicted.code.length, 0);
        assertEq(target.value(), 42);
        assertEq(abi.decode(results[0], (uint256)), 42);
        assertEq(PonsPrivacyAccount(payable(predicted)).nonce(), 1);
    }

    function testSignatureBindsNativePrefund() external {
        IPonsPrivacyAccount.Call[] memory calls = _setValueCalls(9);
        uint256 deadline = block.timestamp + 10 minutes;
        bytes memory signature = _sign(predicted, calls, 0, deadline, 1 ether);

        vm.expectRevert(PonsPrivacyAccount.InvalidSignature.selector);
        factory.deployAndExecute{ value: 0.5 ether }(
            owner, ACCOUNT_INDEX, calls, 0, deadline, address(0), 0, address(0), signature
        );
    }

    function testReplayIsRejected() external {
        IPonsPrivacyAccount.Call[] memory calls = _setValueCalls(11);
        uint256 deadline = block.timestamp + 10 minutes;
        bytes memory signature = _sign(predicted, calls, 0, deadline, 0);
        factory.deployAndExecute(
            owner, ACCOUNT_INDEX, calls, 0, deadline, address(0), 0, address(0), signature
        );

        vm.expectRevert(
            abi.encodeWithSelector(PonsPrivacyAccount.InvalidNonce.selector, uint256(1), uint256(0))
        );
        PonsPrivacyAccount(payable(predicted))
            .execute(calls, 0, deadline, address(0), 0, address(0), signature);
    }

    function _setValueCalls(uint256 value)
        internal
        view
        returns (IPonsPrivacyAccount.Call[] memory calls)
    {
        calls = new IPonsPrivacyAccount.Call[](1);
        calls[0] = IPonsPrivacyAccount.Call({
            target: address(target), value: 0, data: abi.encodeCall(ValueTarget.setValue, (value))
        });
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
