#!/usr/bin/perl

use Modern::Perl;

use Test::More tests => 3;
use Test::NoWarnings;

use FindBin;
use lib "$FindBin::Bin/..";

use Koha::Database;
use Mojo::JSON qw(encode_json);

use Koha::Plugin::Com::OlorinAutoPrinter::Olorin;

my $schema = Koha::Database->new->schema;

subtest 'default_config() tests' => sub {
    plan tests => 4;

    my $config = Koha::Plugin::Com::OlorinAutoPrinter::Olorin->default_config;

    is( $config->{schema_version}, 1, 'schema version present' );
    is( $config->{close_delay_ms}, 350, 'default close delay' );

    my $on = grep { $_->{mode} ne 'off' } values %{ $config->{types} };
    is( $on, 0, 'every slip type defaults to off' );

    ok( exists $config->{types}->{pos_receipt}->{kick_drawer}, 'pos_receipt has a kick_drawer setting' );
};

subtest 'save_config() and get_config() tests' => sub {
    plan tests => 7;

    $schema->storage->txn_begin;

    my $plugin = Koha::Plugin::Com::OlorinAutoPrinter::Olorin->new( { enable_plugins => 1 } );

    my $incoming = {
        close_delay_ms => '500',
        types          => {
            checkinslip => { mode => 'auto', printer => 'receipt_printer', auto_close => 1 },
            issueqslip  => { mode => 'manual', printer => 'not_a_real_printer', auto_close => 0 },
            pos_receipt => { mode => 'auto', printer => 'receipt_printer', auto_close => 1, kick_drawer => 1 },
            bogus_type  => { mode => 'auto', printer => 'receipt_printer' },
        },
    };
    $plugin->save_config($incoming);

    my $config = $plugin->get_config;
    is( $config->{close_delay_ms}, 500, 'close delay saved' );
    is( $config->{types}->{checkinslip}->{mode}, 'auto', 'checkinslip mode saved' );
    is( $config->{types}->{issueqslip}->{mode}, 'manual', 'issueqslip mode saved' );
    is( $config->{types}->{issueqslip}->{printer},
        'receipt_printer', 'invalid printer rejected, default kept' );
    ok( $config->{types}->{pos_receipt}->{kick_drawer}, 'kick_drawer saved for pos_receipt' );
    ok( !exists $config->{types}->{bogus_type}, 'unknown slip types are dropped' );

    # A stored config missing newer keys is merged over defaults
    $plugin->store_data(
        { configuration => encode_json( { types => { checkinslip => { mode => 'auto' } } } ) } );
    $config = $plugin->get_config;
    is( $config->{types}->{transfer}->{mode}, 'off', 'missing types gain defaults on read' );

    $schema->storage->txn_rollback;
};
