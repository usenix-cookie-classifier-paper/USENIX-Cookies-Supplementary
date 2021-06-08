# Supplementary Material for "Automating Cookie Consent and GDPR Violation Detection"

This repository contains supplementary material for the USENIX submission "Automating Cookie Consent and GDPR Violation Detection".

Intended for USENIX review purposes only.

## Contents

1. An extended report that describes different aspects of the paper in greater detail. The report has been written some months prior to the paper and includes an older set of measurements. As such, the reported values will no longer match, but the procedures used to compute them remain the same.

2. The source code, as well as packed zip file of the extension described in the paper. In order to use the extension, please follow the instructions given below.


## Extension Installation and Usage

The extension is compatible with both Firefox and Chromium-based browsers.

### Firefox

The provided zip file is unsigned, and will need to be installed using Firefox ESR or Firefox Nightly. Additionally, the config flag `xpinstall.signatures.required` must be set to `false`.

For more instructions, see here:

https://extensionworkshop.com/documentation/publish/distribute-sideloading/

### Chromium

The extension can be installed for testing by enabling developer mode and directly loading the `src` folder contained in this repository.

For more information see:

https://developer.chrome.com/docs/extensions/mv3/faq/

## Disclaimer

AUTHOR NAMES AND LICENSES HAVE BEEN INTENTIONALLY STRIPPED TO FULFILL ANONYMITY REQUIREMENTS.

THE CONTENT OF THIS REPOSITORY IS INTENDED FOR REVIEW PURPOSES ONLY. DO NOT REUPLOAD OR OTHERWISE DISTRIBUTE THE CONTENTS OF THIS REPOSITORY.
