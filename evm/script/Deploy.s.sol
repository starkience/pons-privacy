// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.30;

import { Script } from "forge-std/Script.sol";
import { PonsPrivacyAccountFactory } from "../src/PonsPrivacyAccountFactory.sol";

contract Deploy is Script {
    function run() external returns (PonsPrivacyAccountFactory factory) {
        vm.startBroadcast();
        factory = new PonsPrivacyAccountFactory();
        vm.stopBroadcast();
    }
}
