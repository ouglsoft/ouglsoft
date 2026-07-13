# Private Dhamet training

The Worker writes one privacy-clean raw record per completed eligible match to the private R2 binding `TRAINING_BUCKET`. No model is served by Pages or committed to GitHub.

Create the private bucket named `dhamet-training-private`, then add these repository secrets for the scheduled workflow:

- `R2_ENDPOINT_URL`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET` (normally `dhamet-training-private`)

The workflow trains a compact Policy/Value model, reuses the compatible current checkpoint, validates ONNX parity and non-regression, stores `current` and `previous` privately in R2, and removes older versions only after promotion. Scheduled runs skip when there is no sufficiently large new dataset; a forced low-data run is diagnostic only and never promotes a model.

To bound private storage and listing work over time, configure an R2 lifecycle rule for `raw/` records (for example, an expiry appropriate to the desired replay horizon). This is a bucket policy, not an application request, and the training workflow retains only the current and previous accepted model versions.
