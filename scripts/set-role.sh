#!/bin/bash
# Give an existing user exactly one role (removes their other role groups first).
# Usage: scripts/set-role.sh <email> <expert|learner|supervisor>
set -euo pipefail
[ $# -eq 2 ] || { echo "Usage: $0 <email> <expert|learner|supervisor>"; exit 1; }
EMAIL=$1; ROLE=$2
[[ "$ROLE" =~ ^(expert|learner|supervisor)$ ]] || { echo "role: expert, learner or supervisor"; exit 1; }
POOL=${COGNITO_USER_POOL_ID:-us-east-1_YyfcIjRiS}
A="aws --region us-east-1 cognito-idp"
for g in $($A admin-list-groups-for-user --user-pool-id "$POOL" --username "$EMAIL" --query 'Groups[].GroupName' --output text); do
  $A admin-remove-user-from-group --user-pool-id "$POOL" --username "$EMAIL" --group-name "$g"
done
$A admin-add-user-to-group --user-pool-id "$POOL" --username "$EMAIL" --group-name "$ROLE"
echo "$EMAIL is now: $ROLE (they must sign out and in again)"
