// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract AuditRegistry {

    struct AuditReport {
        address requester;
        string contractName;
        uint256 securityScore;
        string ipfsCid;
        uint256 timestamp;
    }

    AuditReport[] public audits;

    event AuditStored(
        address indexed requester,
        string contractName,
        uint256 securityScore,
        string ipfsCid,
        uint256 timestamp
    );

    function storeAudit(
        string memory _contractName,
        uint256 _securityScore,
        string memory _ipfsCid
    ) public {
        AuditReport memory report = AuditReport({
            requester: msg.sender,
            contractName: _contractName,
            securityScore: _securityScore,
            ipfsCid: _ipfsCid,
            timestamp: block.timestamp
        });

        audits.push(report);

        emit AuditStored(
            msg.sender,
            _contractName,
            _securityScore,
            _ipfsCid,
            block.timestamp
        );
    }

    function getAudit(uint256 index)
        public
        view
        returns (
            address requester,
            string memory contractName,
            uint256 securityScore,
            string memory ipfsCid,
            uint256 timestamp
        )
    {
        AuditReport memory report = audits[index];
        return (
            report.requester,
            report.contractName,
            report.securityScore,
            report.ipfsCid,
            report.timestamp
        );
    }

    function totalAudits() public view returns (uint256) {
        return audits.length;
    }
}