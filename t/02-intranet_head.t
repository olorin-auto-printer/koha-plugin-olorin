#!/usr/bin/perl

use Modern::Perl;

use Test::More tests => 3;
use Test::NoWarnings;

use FindBin;
use lib "$FindBin::Bin/..";

use Koha::Database;
use Mojo::JSON qw(decode_json);

use Koha::Plugin::Com::OlorinAutoPrinter::Olorin;

my $schema = Koha::Database->new->schema;

subtest 'intranet_head() output tests' => sub {
    plan tests => 8;

    $schema->storage->txn_begin;

    my $plugin = Koha::Plugin::Com::OlorinAutoPrinter::Olorin->new( { enable_plugins => 1 } );

    is( $plugin->intranet_head, q{}, 'empty output when nothing is enabled' );

    $plugin->save_config(
        { types => { checkinslip => { mode => 'auto', printer => 'receipt_printer', auto_close => 1 } } } );

    my $head = $plugin->intranet_head;
    like( $head, qr{<script type="application/json" id="olorin-config">}, 'config stanza present' );
    like( $head, qr{/api/v1/contrib/olorin/static/js/olorin\.js\?v=}, 'library script tag present' );
    like( $head, qr{/api/v1/contrib/olorin/static/js/olorin-koha\.js\?v=}, 'controller script tag present' );
    like( $head, qr{<script defer}, 'scripts are deferred' );

    my ($json) = $head =~ m{id="olorin-config">(.*?)</script>}s;
    my $client_config = decode_json($json);
    is( ref $client_config->{types}, 'ARRAY', 'client config types is an ordered array' );

    my ($checkinslip) = grep { $_->{key} eq 'checkinslip' } @{ $client_config->{types} };
    is( $checkinslip->{mode}, 'auto', 'enabled type carried into client config' );
    is( $checkinslip->{path}, '/members/printslip.pl', 'registry path merged into client config' );

    $schema->storage->txn_rollback;
};

subtest 'JSON escaping tests' => sub {
    plan tests => 1;

    is(
        Koha::Plugin::Com::OlorinAutoPrinter::Olorin::_escape_json_for_html('{"x":"</script>"}'),
        '{"x":"<\\/script>"}',
        'a </ sequence cannot terminate the stanza'
    );
};
