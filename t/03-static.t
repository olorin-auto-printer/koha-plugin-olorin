#!/usr/bin/perl

use Modern::Perl;

use Test::More tests => 7;
use Test::NoWarnings;

use FindBin;
use lib "$FindBin::Bin/..";

use Koha::Plugin::Com::OlorinAutoPrinter::Olorin;

my $plugin = Koha::Plugin::Com::OlorinAutoPrinter::Olorin->new( { enable_plugins => 1 } );

is( $plugin->api_namespace, 'olorin', 'api_namespace' );

my $routes = $plugin->static_routes;
is( ref $routes, 'HASH', 'static_routes returns a spec hash' );

for my $route ( '/js/olorin.js', '/js/olorin-koha.js' ) {
    ok( exists $routes->{$route}, "route $route declared" );
    my $file = $plugin->bundle_path . $route;
    ok( -e $file, "bundled file exists for $route" );
}
