import { Construct } from 'constructs';

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as logs from 'aws-cdk-lib/aws-logs'

export class EcsCloudmapStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const serviceName = "my-service";
    const namespace = "my-namespace";

    const vpc = ec2.Vpc.fromLookup(this, "VPC", {
      isDefault: true,
    });

    const cluster = new ecs.Cluster(this, "EcsServiceDiscovery", {
      vpc: vpc,
    });

    const dnsNamespace = new servicediscovery.PrivateDnsNamespace(
      this,
      "DnsNamespace",
      {
        name: namespace,
        vpc: vpc,
        description: "Private DnsNamespace for my Microservices",
      }
    );

    const taskrole = new iam.Role(this, "ecsTaskExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    taskrole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AmazonECSTaskExecutionRolePolicy"
      )
    );

    /*
     * Check the doc for the allowed cpu/mem combiations:
     * https://docs.aws.amazon.com/cdk/api/latest/docs/@aws-cdk_aws-ecs.FargateTaskDefinition.html
     */
    const serviceTaskDefinition = new ecs.FargateTaskDefinition(
      this,
      `${serviceName}ServiceTaskDef`,
      {
        cpu: 256,
        memoryLimitMiB: 512,
        taskRole: taskrole,
      }
    );

    const serviceLogGroup = new logs.LogGroup(
      this,
      `${serviceName}ServiceLogGroup`,
      {
        logGroupName: `/ecs/${serviceName}Service`,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }
    );

    /* Fargate only support awslog driver */
    const serviceLogDriver = new ecs.AwsLogDriver({
      logGroup: serviceLogGroup,
      streamPrefix: `${serviceName}Service`,
    });

    /*
     * If you chose a public image from the registry (like in this case),
     * the `assignPublicIp` in the Fargate definition (below) must be true
     */
    const serviceContainer = serviceTaskDefinition.addContainer(
      `${serviceName}ServiceContainer`,
      {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        logging: serviceLogDriver,
      }
    );

    serviceContainer.addPortMappings({
      containerPort: 80,
    });

    const serviceSecGrp = new ec2.SecurityGroup(
      this,
      `${serviceName}ServiceSecurityGroup`,
      {
        allowAllOutbound: true,
        securityGroupName: `${serviceName}ServiceSecurityGroup`,
        vpc: vpc,
      }
    );

    serviceSecGrp.connections.allowFromAnyIpv4(ec2.Port.tcp(80));

    new ecs.FargateService(this, `${serviceName}Service`, {
      cluster: cluster,
      taskDefinition: serviceTaskDefinition,
      // Must be `true` when using public images
      assignPublicIp: true,
      // If you set it to 0, the deployment will finish succesfully anyway
      desiredCount: 1,
      securityGroups: [serviceSecGrp],
      cloudMapOptions: {
        // This will be your service_name.namespace
        name: serviceName,
        cloudMapNamespace: dnsNamespace,
        dnsRecordType: servicediscovery.DnsRecordType.A,
      },
    });
  }
}
