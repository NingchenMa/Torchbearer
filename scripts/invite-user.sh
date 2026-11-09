#!/bin/bash
# Invite someone to TorchBearer. Cognito emails them a temporary password; they set their own at first sign-in.
# Usage: scripts/invite-user.sh <email> "<Full Name>" <company-id> <role>
#   role = expert (old employee: records, checks, approves) | learner (new hire: trains) | supervisor (everything)
#   company-id = the folder their data lives in (orgs/<company-id>/ in S3), e.g. acme-foods. New id = new, empty company. Our own team: torchbearer.
set -euo pipefail
[ $# -eq 4 ] || { echo "Usage: $0 <email> \"<Full Name>\" <company-id> <expert|learner|supervisor>"; exit 1; }
EMAIL=$1; NAME=$2; ORG=$3; ROLE=$4
[[ "$ROLE" =~ ^(expert|learner|supervisor)$ ]] || { echo "role: expert, learner or supervisor"; exit 1; }
[[ "$ORG" =~ ^[a-z0-9-]{2,64}$ ]] || { echo "company-id: lowercase letters, digits and dashes only"; exit 1; }
POOL=${COGNITO_USER_POOL_ID:-us-east-1_YyfcIjRiS}
aws --region us-east-1 cognito-idp admin-create-user --user-pool-id "$POOL" --username "$EMAIL" \
  --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true Name=name,Value="$NAME" Name=custom:org,Value="$ORG" \
  --desired-delivery-mediums EMAIL --query 'User.UserStatus' --output text
aws --region us-east-1 cognito-idp admin-add-user-to-group --user-pool-id "$POOL" --username "$EMAIL" --group-name "$ROLE"
echo "Invited $EMAIL to company '$ORG' as $ROLE. They sign in at https://aws.d32tnuo1sla34.amplifyapp.com"
